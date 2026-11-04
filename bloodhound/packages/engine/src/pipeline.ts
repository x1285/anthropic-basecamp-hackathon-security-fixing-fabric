// The Bloodhound pipeline: incident -> scan & SLA -> notice draft -> grouping -> recipes -> sandboxed fixes
// -> simulated PRs -> merge & deploy -> re-scan (verified closure) -> resolution notice.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseOsv,
  scanRepos,
  affectedSummary,
  effectiveSla,
  slaStatus,
  groupFindings,
  complexityFor,
  choosePilot,
  rankRepos,
  type OsvPayload,
  type Incident,
  type Finding,
  type ScanRepo,
  type ScanEnv,
  type Severity,
  type Complexity,
  type Strategy,
} from '@bloodhound/core';
import { applyRecipe, diffWorkdir, prepareWorkdir, simulateTests, type RecipeStep, type TestRules } from '@bloodhound/sandbox';
import { createFakeAdapters } from '@bloodhound/adapters';
import { draftRecipe, groupRationale, noticeDraft, personalize, learningNote, type GroupInput } from '@bloodhound/agent';
import { prisma, flag, audit } from './db';
import { ROOT, workDir } from './paths';

/** Config defaults from the concept (section 5). P7 makes them binding. */
export const CONFIG = {
  maxAttemptsPerRepo: 3,
  attemptTimeLimitMs: 30 * 60_000,
  pilotFailuresToEscalateGroup: 2,
  slaAlarmAt: 0.5,
  approvalEscalateAt: 0.1,
  pilotTightHours: 12,
} as const;

/** Fake adapters for this build. Only fakes run; real systems come later as drop-in implementations. */
export const adapters = createFakeAdapters();

type Json = Record<string, any>;

interface WorldEnv {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  slaFloorHours: number;
  versions: Record<string, Record<string, string>>;
}

interface World {
  repos: ScanRepo[];
  envs: WorldEnv[];
  customers: Array<{ id: string; name: string; slaHours: Partial<Record<Severity, number>>; envIds: string[]; email: string }>;
}

async function loadWorld(): Promise<World> {
  const [repos, envs, customers, projects] = await Promise.all([
    prisma.repo.findMany(),
    prisma.environment.findMany(),
    prisma.customer.findMany({ include: { environments: true } }),
    prisma.project.findMany(),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  return {
    repos: repos.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      direct: r.direct as string[],
      declared: r.declared as Record<string, string>,
      lock: r.lock as Record<string, string>,
    })),
    envs: envs.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      projectName: projectName.get(e.projectId) ?? e.projectId,
      name: e.name,
      slaFloorHours: (e.rules as Json).slaFloorHours as number,
      versions: e.versions as Record<string, Record<string, string>>,
    })),
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      email: ((c.contacts as Json[])[0]?.email as string) ?? 'ops@example.com',
      slaHours: c.slaHours as Partial<Record<Severity, number>>,
      envIds: c.environments.map((x) => x.environmentId),
    })),
  };
}

function incidentOf(row: { payload: unknown }): Incident {
  return parseOsv(row.payload as OsvPayload);
}

async function readTestRules(repoDirPath: string): Promise<TestRules> {
  return JSON.parse(await readFile(join(ROOT, repoDirPath, 'bloodhound.test.json'), 'utf8')) as TestRules;
}

// ---------- ingest ----------

export async function ingestIncident(payload: OsvPayload): Promise<{ runId: string }> {
  const incident = parseOsv(payload);
  await prisma.incident.upsert({
    where: { id: incident.id },
    update: {},
    create: {
      id: incident.id,
      payload: payload as object,
      packageName: incident.packageName,
      fixedVersion: incident.fixedVersion,
      severity: incident.severity,
      detectedAt: incident.detectedAt,
    },
  });
  const run = await prisma.run.create({ data: { incidentId: incident.id, status: 'scanning' } });
  const world = await loadWorld();
  const findings = scanRepos(incident, world.repos, world.envs as ScanEnv[]);
  const summary = affectedSummary(findings);

  const slaByEnv: Record<string, { hours: number; source: string; strictestCustomerId?: string }> = {};
  for (const env of world.envs.filter((e) => summary.envIds.includes(e.id))) {
    const custs = world.customers.filter((c) => c.envIds.includes(env.id));
    slaByEnv[env.id] = effectiveSla(incident.severity, custs, env.slaFloorHours);
  }
  await prisma.run.update({ where: { id: run.id }, data: { scan: findings as unknown as object[], slaByEnv: slaByEnv as object } });
  for (const repoId of summary.repoIds) {
    await prisma.repoState.create({ data: { id: `${run.id}:${repoId}`, runId: run.id, repoId, status: 'open' } });
  }
  await audit('system', 'incident.scanned', run.id, { incident: incident.id, repos: summary.repoIds, envs: summary.envIds });

  const envNames = world.envs.filter((e) => summary.envIds.includes(e.id)).map((e) => `${e.projectName} ${e.name}`);
  const slaHours = Object.values(slaByEnv).reduce((min, s) => Math.min(min, s.hours), Infinity);
  const body = await noticeDraft({
    incidentId: incident.id,
    packageName: incident.packageName,
    severity: incident.severity,
    envNames,
    slaHours: Number.isFinite(slaHours) ? slaHours : 0,
  });
  await prisma.message.create({ data: { runId: run.id, kind: 'incident_notice', body, status: 'pending' } });

  if (incident.fixedVersion === null) {
    // No fixed version exists: nothing to group, every affected repo is escalated with manual steps.
    for (const repoId of summary.repoIds) {
      await escalateRepo(run.id, repoId, 'no fixed version exists', [
        `Decide on a mitigation for ${incident.packageName}: no fixed release is published.`,
        'Replace or remove the dependency, or isolate the code path that handles untrusted input.',
        'Re-scan the affected environments after the change is deployed.',
      ]);
    }
  } else {
    await groupRun(run.id);
    await fixRun(run.id);
  }
  await refreshRunStatus(run.id);
  return { runId: run.id };
}

// ---------- approval & fan-out ----------

export async function approveMessage(messageId: string, actor: string): Promise<{ copies: number }> {
  const msg = await prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: { run: { include: { incident: true } } } });
  if (msg.status !== 'pending') return { copies: 0 };
  await prisma.message.update({ where: { id: msg.id }, data: { status: 'approved' } });
  await audit(actor, 'message.approved', msg.id, { kind: msg.kind, run: msg.runId });

  const world = await loadWorld();
  const affectedEnvs = new Set((msg.run.scan as unknown as Finding[]).filter((f) => f.affected && f.envId).map((f) => f.envId as string));
  const incident = incidentOf(msg.run.incident);
  const targets = world.customers.filter((c) => c.envIds.some((e) => affectedEnvs.has(e)));
  for (const c of targets) {
    const envNames = world.envs.filter((e) => affectedEnvs.has(e.id) && c.envIds.includes(e.id)).map((e) => `${e.projectName} ${e.name}`);
    const text = personalize(msg.body, c.name, envNames);
    await prisma.message.create({ data: { runId: msg.runId, kind: 'outbox_copy', customerId: c.id, body: text, status: 'sent' } });
    await adapters.mailer.send({ to: c.email, subject: `Sicherheitshinweis ${incident.packageName}`, body: text });
  }
  if (msg.kind === 'resolution_notice') await refreshRunStatus(msg.runId);
  return { copies: targets.length };
}

// ---------- grouping & recipes ----------

interface RepoCtx {
  repoId: string;
  groupId: string;
  version: string;
  strategy: Strategy;
  complexity: Complexity;
  hasTests: boolean;
  envIds: string[];
}

async function repoContexts(incident: Incident, runScan: Finding[], groups: Array<{ id: string; strategy: string; repoIds: unknown }>): Promise<RepoCtx[]> {
  const repos = await prisma.repo.findMany();
  const byId = new Map(repos.map((r) => [r.id, r]));
  const out: RepoCtx[] = [];
  for (const g of groups) {
    for (const repoId of g.repoIds as string[]) {
      const repo = byId.get(repoId);
      if (!repo) continue;
      const hits = runScan.filter((f) => f.repoId === repoId && f.affected);
      const version = hits.find((f) => f.scope === 'main')?.version ?? hits[0]?.version ?? '0.0.0';
      const rules = await readTestRules(repo.dirPath);
      out.push({
        repoId,
        groupId: g.id,
        version,
        strategy: g.strategy as Strategy,
        complexity: complexityFor(incident, version, g.strategy as Strategy, rules.codeChecks.length),
        hasTests: Object.keys(rules.greenWhen ?? {}).length > 0,
        envIds: [...new Set(hits.map((f) => f.envId).filter((x): x is string => !!x))],
      });
    }
  }
  return out;
}

function maxComplexity(values: Complexity[]): Complexity {
  const rank = { S: 0, M: 1, L: 2 } as const;
  return values.reduce<Complexity>((max, c) => (rank[c] > rank[max] ? c : max), 'S');
}

async function groupRun(runId: string): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { incident: true } });
  const incident = incidentOf(run.incident);
  await prisma.run.update({ where: { id: runId }, data: { status: 'grouping' } });
  const world = await loadWorld();
  const repoMap = new Map(world.repos.map((r) => [r.id, r]));
  const runScan = run.scan as unknown as Finding[];
  const groups = groupFindings(incident, runScan, repoMap);

  for (const g of groups) {
    const members = g.repoIds.map((repoId) => {
      const hits = runScan.filter((f) => f.repoId === repoId && f.affected);
      return { id: repoId, version: hits.find((f) => f.scope === 'main')?.version ?? hits[0]?.version ?? '', scopes: hits.map((f) => f.scope) };
    });
    const input: GroupInput = {
      signature: g.signature,
      packageName: incident.packageName,
      fixedVersion: incident.fixedVersion!,
      strategy: g.strategy,
      repos: members,
    };
    const ctx = await repoContexts(incident, runScan, [{ id: g.signature, strategy: g.strategy, repoIds: g.repoIds }]);
    const complexity = maxComplexity(ctx.map((c) => c.complexity));

    // Memory: the recipe for this signature may already exist from an earlier run.
    const existing = await prisma.recipe.findUnique({ where: { signature: g.signature } });
    const recipe = existing ?? (await createRecipeOrReuse(g.signature, input, complexity));
    const rationale = await groupRationale(input);
    await prisma.group.create({
      data: {
        runId,
        signature: g.signature,
        strategy: g.strategy,
        rationale: (existing ? `Recipe v${recipe.version} reused from memory. ` : '') + rationale.rationale,
        confidence: rationale.confidence,
        repoIds: g.repoIds,
        status: 'open',
        recipeId: recipe.id,
      },
    });
  }
}

/**
 * Drafts a recipe and stores it with version 1. If a concurrent run stored the same signature first,
 * the stored recipe is reused (unique constraint on the signature).
 */
async function createRecipeOrReuse(signature: string, input: GroupInput, complexity: Complexity) {
  const drafted = await draftRecipe(input);
  try {
    return await prisma.recipe.create({
      data: {
        signature,
        strategy: drafted.value.strategy,
        steps: drafted.value.steps as unknown as object[],
        breaking: drafted.value.breaking,
        verification: drafted.value.verification,
        complexity,
        confidence: drafted.value.confidence,
        version: 1,
        versions: {
          create: { version: 1, steps: drafted.value.steps as unknown as object[], learning: `Drafted for ${signature} (${drafted.source}).` },
        },
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err;
    return prisma.recipe.findUniqueOrThrow({ where: { signature } });
  }
}

// ---------- fixing ----------

async function fixRun(runId: string): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { incident: true, groups: true } });
  const incident = incidentOf(run.incident);
  await prisma.run.update({ where: { id: runId }, data: { status: 'fixing' } });
  const allowCodeChanges = await flag('recipe.allowCodeChanges', false);
  const pilotDone = new Set<string>();
  const pilotFailures = new Map<string, number>();
  const escalatedGroups = new Set<string>();
  const groupStatus = new Map<string, string>();
  const slaByEnv = run.slaByEnv as Record<string, { hours: number }>;

  for (let guard = 0; guard < 500; guard++) {
    const open = (await prisma.repoState.findMany({ where: { runId, status: 'open' } })).map((s) => s.repoId);
    const ctxAll = await repoContexts(incident, run.scan as unknown as Finding[], run.groups.map((g) => ({ id: g.id, strategy: g.strategy, repoIds: g.repoIds })));
    const world = await loadWorld();
    const now = new Date();
    // Recalculate ranking from current deadlines and states after every repo.
    const ranks = ctxAll
      .filter((c) => open.includes(c.repoId) && !escalatedGroups.has(c.groupId))
      .map((c) => {
        const remaining = c.envIds.map((e) => slaStatus(incident.detectedAt, slaByEnv[e]?.hours ?? 0, now).remainingHours);
        const customers = world.customers.filter((cu) => cu.envIds.some((e) => c.envIds.includes(e))).length;
        return {
          repoId: c.repoId,
          groupId: c.groupId,
          remainingHours: remaining.length ? Math.min(...remaining) : Infinity,
          complexity: c.complexity,
          customers,
          hasTests: c.hasTests,
        };
      });
    if (ranks.length === 0) break;

    // Pilot first: a group without a finished pilot may only work its pilot repo until the pilot has an outcome.
    const pilotFor = new Map<string, string>();
    for (const g of run.groups) {
      if (pilotDone.has(g.id) || escalatedGroups.has(g.id)) continue;
      const pilot = choosePilot(
        ranks.filter((r) => r.groupId === g.id),
        CONFIG.pilotTightHours,
      );
      if (pilot) pilotFor.set(g.id, pilot.repoId);
    }
    const candidates = ranks.filter((r) => !pilotFor.has(r.groupId) || pilotFor.get(r.groupId) === r.repoId);
    const next = rankRepos(candidates)[0];
    if (!next) break;
    const group = run.groups.find((g) => g.id === next.groupId)!;
    const isPilot = pilotFor.get(group.id) === next.repoId;

    const result = await fixRepo(runId, group.id, group.recipeId!, next.repoId, incident, allowCodeChanges);
    if (result.outcome === 'green') {
      if (isPilot) pilotDone.add(group.id);
      groupStatus.set(group.id, 'fixed');
      continue;
    }
    if (!isPilot) {
      await escalateRepo(runId, next.repoId, result.reason, manualSteps(incident, result.checks));
      continue;
    }
    // Pilot failed: revise the recipe once and retry; a second failure escalates the whole group.
    const n = (pilotFailures.get(group.id) ?? 0) + 1;
    pilotFailures.set(group.id, n);
    await prisma.group.update({ where: { id: group.id }, data: { pilotFailures: n } });
    if (n < CONFIG.pilotFailuresToEscalateGroup) {
      await reviseRecipe(group.recipeId!, `pilot ${next.repoId} failed (${result.reason}); revised recipe before retry`);
      continue;
    }
    escalatedGroups.add(group.id);
    pilotDone.add(group.id);
    groupStatus.set(group.id, 'escalated');
    for (const member of ctxAll.filter((c) => c.groupId === group.id)) {
      const st = await prisma.repoState.findUnique({ where: { runId_repoId: { runId, repoId: member.repoId } } });
      if (st?.status === 'open') await escalateRepo(runId, member.repoId, 'pilot failed twice, group escalated', manualSteps(incident, result.checks));
    }
  }
  for (const [groupId, status] of groupStatus) {
    await prisma.group.update({ where: { id: groupId }, data: { status } });
  }
}

/** One repo: up to 3 attempts within 30 minutes. Does not escalate; the caller decides. */
async function fixRepo(
  runId: string,
  groupId: string,
  recipeId: string,
  repoId: string,
  incident: Incident,
  allowCodeChanges: boolean,
): Promise<{ outcome: 'green' } | { outcome: 'red'; reason: string; checks: string[] }> {
  const repo = await prisma.repo.findUniqueOrThrow({ where: { id: repoId } });
  const source = join(ROOT, repo.dirPath);
  const started = Date.now();
  let attemptNo = 0;
  let failedChecks: string[] = [];

  while (attemptNo < CONFIG.maxAttemptsPerRepo && Date.now() - started < CONFIG.attemptTimeLimitMs) {
    attemptNo++;
    const dir = await prepareWorkdir(source, workDir(runId, repoId));
    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
    const applied = await applyRecipe(dir, recipe.steps as unknown as RecipeStep[], { allowCodeChanges });
    const tests = await simulateTests(dir);
    const log = { applied: applied.applied, skipped: applied.skipped, checks: tests.checks, lock: await lockOf(dir) };

    if (tests.green) {
      const diff = await diffWorkdir(source, dir);
      const attempt = await prisma.fixAttempt.create({
        data: { runId, groupId, repoId, attemptNo, outcome: 'green', log: log as object, diff },
      });
      const title = `Bloodhound: ${incident.packageName} fix for ${repoId}`;
      const pr = await adapters.codeHost.openPullRequest({ repoId, title, diff, checks: tests.checks });
      await prisma.pullRequest.create({
        data: {
          id: `${runId}:${repoId}`, // one PR per run and repo; pr.number is the code host's reference
          attemptId: attempt.id,
          runId,
          repoId,
          title: `${title} (${pr.number})`,
          diff,
          checks: tests.checks as unknown as object[],
          recipeVersion: recipe.version,
        },
      });
      await prisma.repoState.update({ where: { runId_repoId: { runId, repoId } }, data: { status: 'pr_open' } });
      await recordLearning(recipeId, groupId, repoId, 'green', []);
      return { outcome: 'green' };
    }

    failedChecks = tests.checks.filter((c) => !c.ok).map((c) => c.detail);
    await prisma.fixAttempt.create({ data: { runId, groupId, repoId, attemptNo, outcome: 'red', log: log as object } });
  }
  const reason = Date.now() - started >= CONFIG.attemptTimeLimitMs ? 'time limit (30 min) reached' : `attempt limit (${CONFIG.maxAttemptsPerRepo}) reached`;
  await recordLearning(recipeId, groupId, repoId, 'red', failedChecks);
  return { outcome: 'red', reason, checks: failedChecks };
}

function manualSteps(incident: Incident, failed: string[] = []): string[] {
  const steps = [`Bump ${incident.packageName} to ${incident.fixedVersion ?? 'a fixed release (none published)'} and run the test suite.`];
  for (const f of failed) steps.push(`Resolve simulated check: ${f}`);
  steps.push('Deploy and re-scan the affected environments.');
  return steps;
}

async function lockOf(dir: string): Promise<Record<string, string>> {
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(lock.packages)) {
    if (k.startsWith('node_modules/')) out[k.slice('node_modules/'.length)] = v.version;
  }
  return out;
}

async function escalateRepo(runId: string, repoId: string, reason: string, checklist: string[]): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { incident: true } });
  const repo = await prisma.repo.findUniqueOrThrow({ where: { id: repoId }, include: { project: true } });
  const incident = incidentOf(run.incident);
  const ticket = {
    title: `Bloodhound: manual fix needed in ${repoId} (${incident.packageName})`,
    assigneeTeam: repo.project.ownerTeam,
    body: `Reason: ${reason}. Incident ${incident.id}.`,
    checklist,
  };
  const created = await adapters.tickets.create(ticket);
  await prisma.escalation.create({ data: { runId, repoId, reason, ticket: { ...ticket, ticketId: created.id } as object } });
  await prisma.repoState.update({ where: { runId_repoId: { runId, repoId } }, data: { status: 'escalated' } });
  await audit('system', 'repo.escalated', repoId, { run: runId, reason });
}

/** Learnings are written after every repo. The recipe version only moves on a revision. */
async function recordLearning(recipeId: string, groupId: string, repoId: string, outcome: 'green' | 'red', failedChecks: string[]): Promise<void> {
  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
  const text = await learningNote({ signature: group.signature, repoId, outcome, failedChecks });
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  await prisma.recipeVersion.create({ data: { recipeId, version: recipe.version, steps: recipe.steps as object, learning: text } });
}

async function reviseRecipe(recipeId: string, why: string): Promise<void> {
  const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: recipeId } });
  const version = recipe.version + 1;
  await prisma.recipe.update({ where: { id: recipeId }, data: { version } });
  await prisma.recipeVersion.create({ data: { recipeId, version, steps: recipe.steps as object, learning: `Revision ${version}: ${why}` } });
}

// ---------- merge & deploy (the simulated button) ----------

export async function mergeAndDeploy(prId: string, actor: string): Promise<{ repoId: string; verified: boolean }> {
  const pr = await prisma.pullRequest.findUniqueOrThrow({ where: { id: prId }, include: { attempt: true } });
  if (pr.status === 'merged') return { repoId: pr.repoId, verified: false };
  const lock = (pr.attempt.log as Json).lock as Record<string, string>;
  await prisma.pullRequest.update({ where: { id: prId }, data: { status: 'merged' } });
  await prisma.repo.update({ where: { id: pr.repoId }, data: { lock } });

  const run = await prisma.run.findUniqueOrThrow({ where: { id: pr.runId } });
  const scan = run.scan as unknown as Finding[];
  const envIds = [...new Set(scan.filter((f) => f.repoId === pr.repoId && f.affected && f.envId).map((f) => f.envId as string))];
  for (const envId of envIds) {
    const env = await prisma.environment.findUniqueOrThrow({ where: { id: envId } });
    const versions = { ...(env.versions as Json), [pr.repoId]: lock };
    await prisma.environment.update({ where: { id: envId }, data: { versions, release: `${env.release}+fix-${pr.repoId}`, deployedAt: new Date() } });
  }
  await audit(actor, 'pr.merged_and_deployed', prId, { repo: pr.repoId, envs: envIds });

  // Verified closure: re-scan the repo against main and the environments where it is deployed.
  const incident = incidentOf(await prisma.incident.findUniqueOrThrow({ where: { id: run.incidentId } }));
  const world = await loadWorld();
  const findings = scanRepos(incident, world.repos.filter((r) => r.id === pr.repoId), world.envs as ScanEnv[]);
  const verified = !findings.some((f) => f.affected);
  if (verified) {
    await prisma.repoState.update({ where: { runId_repoId: { runId: run.id, repoId: pr.repoId } }, data: { status: 'fixed' } });
    await audit('system', 'repo.verified_fixed', pr.repoId, { run: run.id });
  }
  await refreshRunStatus(run.id);
  return { repoId: pr.repoId, verified };
}

// ---------- run status & resolution ----------

export async function refreshRunStatus(runId: string): Promise<void> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { messages: true, incident: true } });
  const states = await prisma.repoState.findMany({ where: { runId } });
  if (states.some((s) => s.status === 'open')) {
    await prisma.run.update({ where: { id: runId }, data: { status: 'fixing' } });
    return;
  }
  if (states.some((s) => s.status === 'pr_open')) {
    await prisma.run.update({ where: { id: runId }, data: { status: 'awaiting_deploy' } });
    return;
  }
  if (!run.messages.some((m) => m.kind === 'resolution_notice')) {
    const incident = incidentOf(run.incident);
    const fixed = states.filter((s) => s.status === 'fixed').length;
    const escalated = states.filter((s) => s.status === 'escalated').length;
    const body = `Die Schwachstelle ${incident.packageName} (${incident.id}) ist in ${fixed} Repo(s) behoben und dort verifiziert.${
      escalated ? ` Für ${escalated} Repo(s) sind manuelle Schritte nötig; wir melden uns dazu gesondert.` : ''
    }`;
    await prisma.message.create({ data: { runId, kind: 'resolution_notice', body, status: 'pending' } });
  }
  const resolved = run.messages.some((m) => m.kind === 'resolution_notice' && m.status !== 'pending');
  await prisma.run.update({ where: { id: runId }, data: { status: resolved ? 'done' : 'awaiting_resolution' } });
}

