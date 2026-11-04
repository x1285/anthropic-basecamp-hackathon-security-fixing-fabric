// One incident run: build (steps 1-4), fix (steps 6-7), notices and verification (steps 3, 8-9).
import { evaluate } from './evaluate';
import { FINAL, eligible, makeGroups, priority, choosePilot } from './plan';
import { fixedFor } from './versions';
import type {
  Customer, Eco, Environment, Group, Incident, PlannedRow, Recipient, RepoResult, RepoState, Run, Sev, World,
} from './model';
import { SEVS, ECOS } from './model';
import { dnum, dueText, fill, fmtDue, listText, uniq } from './util';

export const ADVISORY = {
  subject: 'Security advisory {incident}: {project}',
  body: 'Hello {customer},\n\nWe are tracking a security issue ({incident}, {severity}) in a software component used by {project}. This affects your {environment}.\n\nWe will have it fixed by {deadline} at the latest and will confirm once the fix is live.\n\nNo action is needed from you right now.\n\nYour operations team',
};
export const RESOLUTION = {
  subject: 'Resolved: security advisory {incident}',
  body: 'Hello {customer},\n\nThe security issue {incident} is fixed in {project}. The fix is live on your {environment}.\n\nNo action is needed from you.\n\nYour operations team',
};
export const UNAFFECTED = {
  subject: 'Security advisory {incident}: not affected',
  body: 'Hello {customer},\n\nWe checked your systems against security issue {incident}. None of your environments is affected, and no action is needed.\n\nYour operations team',
};

export const custName = (run: Pick<Run, 'custs'>, id: string): string =>
  run.custs.find((c) => c.id === id)?.name ?? '?';

/** Builds a run from the world: scans every watched repo, drafts customer notices, groups and plans fixes. */
export function buildRun(world: World, inc: Incident, now: number, rng: () => number, runId: string): Run {
  const envs: Environment[] = structuredClone(world.envs);
  const custs: Customer[] = structuredClone(world.customers);
  const results: RepoResult[] = [];
  for (const p of world.projects) {
    for (const r of p.repos.filter((x) => x.watched)) results.push(evaluate(r, p, inc, envs, custs));
  }
  const affected = results.filter((r) => r.verdict === 'affected');

  // one notice per customer, one line per project and environment; the tightest deadline wins
  const rec = new Map<string, { id: string; items: Map<string, Recipient['items'][number]> }>();
  for (const r of affected) {
    for (const x of r.envs.filter((e) => e.state === 'affected')) {
      for (const cid of x.customers) {
        const c = rec.get(cid) ?? { id: cid, items: new Map() };
        rec.set(cid, c);
        const k = r.projectName + '|' + x.name;
        const prev = c.items.get(k);
        if (!prev || dnum(x.slaHours) < dnum(prev.hours)) {
          c.items.set(k, { project: r.projectName, projectId: r.projectId, env: x.name, hours: x.slaHours });
        }
      }
    }
  }
  const recipients: Recipient[] = [...rec.values()]
    .map((c) => {
      const items = [...c.items.values()];
      const due = Math.min(...items.map((i) => dnum(i.hours)));
      return { id: c.id, items, due: due === Infinity ? null : due };
    })
    .sort((a, b) => dnum(a.due) - dnum(b.due));

  const watchedCust = new Set(world.projects
    .filter((p) => p.repos.some((r) => r.watched))
    .flatMap((p) => Object.values(p.envs).flatMap((e) => e.customers)));
  const unaffected = custs
    .filter((c) => c.notifyUnaffected && !rec.has(c.id) && watchedCust.has(c.id))
    .map((c) => c.id);

  const run: Run = {
    id: runId, firedAt: now, incident: inc, envs, custs, results, recipients, unaffected,
    notify: {
      status: recipients.length || unaffected.length ? 'pending' : 'none',
      subject: ADVISORY.subject, body: ADVISORY.body, approvedAt: null,
    },
    resolution: { subject: RESOLUTION.subject, body: RESOLUTION.body, sent: [] },
    outbox: [], groups: [], repoState: {}, prSeq: 100 + Math.floor(rng() * 300),
  };
  run.groups = makeGroups(affected, inc);
  run.groups = run.groups.map((g: Group) => ({ ...g, pilot: choosePilot(g, run) }));
  for (const r of affected) run.repoState[r.repoId] = { status: 'queued', attempts: 0, log: [], pr: null, reason: null, recipeVersion: null };
  return run;
}

/** Summary counts for the run list and headline. */
export function runSummary(run: Run): { aff: RepoResult[]; done: number; escd: number } {
  const aff = run.results.filter((r) => r.verdict === 'affected');
  const done = aff.filter((r) => run.repoState[r.repoId]?.status === 'verified').length;
  const escd = aff.filter((r) => run.repoState[r.repoId]?.status === 'escalated').length;
  return { aff, done, escd };
}

export type StepState = 'done' | 'wait' | 'bad';

/** The eight step chips above the run detail. */
export function stepStates(run: Run): [string, StepState, string][] {
  const { aff, done, escd } = runSummary(run);
  const open = priority(run).filter((x) => !(FINAL as readonly string[]).includes(x.st.status)).length;
  const valid = run.groups.filter((g) => g.recipe.confidence === 'Validated').length;
  const pending = run.notify.status === 'pending';
  return [
    ['Incident', 'done', 'Received'],
    ['Scan', 'done', `${aff.length} affected`],
    ['Notify customers', pending ? 'wait' : 'done', pending ? 'Needs approval' : run.notify.status === 'none' ? 'Nobody to notify' : 'Sent'],
    ['Group repos', 'done', `${run.groups.length} group${run.groups.length === 1 ? '' : 's'}`],
    ['Recipes', run.groups.length && valid === run.groups.length ? 'done' : run.groups.length ? 'wait' : 'done', `${valid} of ${run.groups.length} validated`],
    ['Prioritise', 'done', open ? `${open} open` : 'Queue empty'],
    ['Fix', aff.length && done + escd === aff.length ? 'done' : aff.length ? 'wait' : 'done', `${done} of ${aff.length} verified`],
    ['Escalate', escd ? 'bad' : 'done', `${escd} escalated`],
  ];
}

export function waitText(run: Run, now: number): string {
  const n = run.notify;
  if (n.status === 'approved' && n.approvedAt !== null) {
    return `Approved ${Math.max(0, Math.round((n.approvedAt - run.firedAt) / 60000))} min after detection.`;
  }
  const mins = Math.max(0, Math.round((now - run.firedAt) / 60000));
  const tight = Math.min(...run.recipients.map((rc) => dnum(rc.due)));
  if (tight === Infinity) return `Waiting ${mins} min.`;
  const pct = (mins / (tight * 60)) * 100;
  return `Waiting ${mins} min, ${pct.toFixed(1)}% of the tightest SLA (${tight} h). ${pct > 10 ? 'Backup approver pinged.' : 'The backup approver is pinged at 10%.'}`;
}

export function recipientVars(run: Run, rc: Recipient): Record<string, string> {
  const envs = uniq(rc.items.map((i) => i.env));
  return {
    customer: custName(run, rc.id),
    incident: run.incident.id,
    severity: run.incident.severity,
    project: listText(uniq(rc.items.map((i) => i.project))),
    environment: listText(envs) + (envs.length > 1 ? ' environments' : ' environment'),
    deadline: rc.due === null ? 'as soon as possible' : fmtDue(run.firedAt + rc.due * 3600e3),
  };
}

/** Customers whose every affected project is verified and who have not received the resolution yet. */
export function resolvable(run: Run): Recipient[] {
  const done = (pid: string) => run.results
    .filter((r) => r.projectId === pid && r.verdict === 'affected')
    .every((r) => run.repoState[r.repoId]?.status === 'verified');
  return run.recipients.filter((rc) => !run.resolution.sent.includes(rc.id) && rc.items.every((i) => done(i.projectId)));
}

/** Approves the advisory: one personalised message per recipient, plus opt-in "not affected" notices. */
export function approveNotice(run: Run, subject: string, body: string, now: number): void {
  run.notify = { ...run.notify, subject, body, status: 'approved', approvedAt: now };
  for (const rc of run.recipients) {
    const v = recipientVars(run, rc);
    const c = run.custs.find((x) => x.id === rc.id)!;
    run.outbox.push({ to: `${c.name} <${c.contact}>`, subject: fill(subject, v), body: fill(body, v) });
  }
  for (const cid of run.unaffected) {
    const c = run.custs.find((x) => x.id === cid)!;
    const v = { customer: c.name, incident: run.incident.id };
    run.outbox.push({ to: `${c.name} <${c.contact}>`, subject: fill(UNAFFECTED.subject, v), body: fill(UNAFFECTED.body, v) });
  }
}

export function approveResolution(run: Run, subject: string, body: string): number {
  const ready = resolvable(run);
  run.resolution = { ...run.resolution, subject, body };
  for (const rc of ready) {
    const v = recipientVars(run, rc);
    const c = run.custs.find((x) => x.id === rc.id)!;
    run.outbox.push({ to: `${c.name} <${c.contact}>`, subject: fill(subject, v), body: fill(body, v) });
    run.resolution.sent.push(rc.id);
  }
  return ready.length;
}

/** Records the outcome of one repo's pilot-or-rollout step. Pilots raise the recipe version; partial coverage adds a smoke step. */
function learn(g: Group, r: RepoResult, kind: 'pilot' | 'partial' | 'revise', inc: Incident): void {
  const rec = g.recipe, pkg = inc.package, eco: Eco = inc.ecosystem;
  let text: string;
  if (kind === 'pilot') {
    text = rec.complexity === 'L'
      ? `Pilot on ${r.repoName}: the major update needed 2 small edits at the ${pkg} call sites. Added as a recipe step.`
      : eco === 'npm' ? `Pilot on ${r.repoName}: run npm dedupe after the change, otherwise an old ${pkg} copy stays in the lockfile.`
      : eco === 'PyPI' ? `Pilot on ${r.repoName}: pin ${pkg} in the constraints file too, or pip resolves the old version again.`
      : `Pilot on ${r.repoName}: run go mod tidy after go get, or go.sum keeps the old checksum and CI fails.`;
    if (rec.complexity === 'L') rec.steps.splice(rec.steps.length - 3, 0, `Update ${pkg} call sites flagged by the changelog`);
    else if (eco === 'npm') rec.steps.splice(2, 0, 'Run npm dedupe');
  } else if (kind === 'partial') {
    if (rec.learnings.some((l) => l.kind === 'partial')) return;
    text = `${r.repoName}: with partial tests, also run the smoke suite; unit tests missed the ${pkg} call sites.`;
    rec.steps.splice(rec.steps.length - 2, 0, 'Run the smoke suite as well');
  } else {
    text = `Pilot on ${r.repoName} failed without tests. Revised recipe adds a smoke test before the change.`;
    rec.steps.unshift('Add a smoke test that covers the affected code');
  }
  rec.version += 1;
  rec.learnings.push({ v: rec.version, kind, text });
}

/** Runs one planned repo: applies the group's recipe in the simulated sandbox and records the outcome. */
export function runOne(run: Run, row: PlannedRow): void {
  const { r, g } = row;
  const st: RepoState = run.repoState[r.repoId]!;
  const rec = g.recipe, inc = run.incident;
  const log = (t: string) => st.log.push(t);
  st.recipeVersion = rec.version;
  const hitEnvs = r.envs.filter((x) => x.state === 'affected').map((x) => x.name);

  if (g.strategy === 'nofix') {
    st.status = 'escalated';
    st.reason = `No fixed version of ${inc.package} is published.`;
    log('Escalated: no fixed version to upgrade to.');
    return;
  }
  if (g.strategy === 'deploy') {
    const safe = r.envs.filter((x) => x.state === 'patched');
    st.status = 'deploy-ready';
    st.attempts = 1;
    const release = safe.length ? (safe[safe.length - 1]!.release || 'the latest safe release') : 'main';
    log(`Deploy request prepared: promote ${release} to ${listText(hitEnvs)}.`);
    return;
  }

  const ok = r.tests !== 'none' || rec.complexity === 'S';
  if (ok) {
    st.attempts = 1;
    st.status = 'pr';
    st.pr = ++run.prSeq;
    const coverage = r.tests === 'good' ? 'all tests passed' : r.tests === 'some' ? 'tests passed (partial coverage)' : 'no tests, patch-level change';
    log(`Attempt 1 with recipe v${rec.version}: applied in sandbox, build passed, ${coverage}, re-scan clean.`);
    log(`Opened PR #${st.pr}${row.role === 'Pilot' && g.pilot?.review ? ', human review required' : ''}.`);
    if (row.role === 'Pilot') {
      g.pilotDone = true;
      rec.confidence = 'Validated';
      learn(g, r, 'pilot', inc);
      st.recipeVersion = rec.version;
      log(`Recipe validated and updated to v${rec.version}.`);
    } else if (r.tests === 'some') {
      const before = rec.version;
      learn(g, r, 'partial', inc);
      if (rec.version > before) log(`Recipe updated to v${rec.version}.`);
    }
    return;
  }

  st.attempts = 3;
  log(`Attempt 1 with recipe v${rec.version}: build passed, but no tests cover the change.`);
  log('Attempt 2: added a smoke check; it fails on the changed API.');
  log('Attempt 3: stopped at the 30-minute limit.');
  if (row.role === 'Pilot') {
    if (g.revisions === 0) {
      g.revisions = 1;
      learn(g, r, 'revise', inc);
      st.attempts = 0;
      log(`Pilot failed: back to step 5, recipe revised to v${rec.version}. The pilot runs again.`);
      return;
    }
    for (const id of g.members) {
      const s = run.repoState[id]!;
      if (!(FINAL as readonly string[]).includes(s.status)) {
        s.status = 'escalated';
        s.reason = 'The group’s pilot failed twice, so the recipe could not be validated.';
      }
    }
    return;
  }
  st.status = 'escalated';
  st.reason = 'Attempt limit reached: no tests cover the changed code.';
}

/** Runs the next eligible repo, or all of them, recalculating the priority order after each one. */
export function runNext(run: Run): boolean {
  const row = priority(run).find(eligible);
  if (!row) return false;
  runOne(run, row);
  return true;
}

/** Verified closure: the deployed release has been re-scanned as safe in every affected environment. */
export function verify(run: Run, repoId: string): void {
  const r = run.results.find((x) => x.repoId === repoId)!;
  const st = run.repoState[repoId]!;
  st.status = 'verified';
  const names = r.envs.filter((x) => x.state === 'affected').map((x) => x.name);
  st.log.push(`Deployed to ${listText(names)}; re-scan of the deployed releases is clean.`);
}

export function prText(run: Run, r: RepoResult, g: Group): string {
  const inc = run.incident, st = run.repoState[r.repoId]!, rec = g.recipe;
  if (st.status === 'deploy-ready' || g.strategy === 'deploy') {
    const hit = r.envs.filter((x) => x.state === 'affected'), safe = r.envs.filter((x) => x.state === 'patched');
    const release = safe.length ? (safe[safe.length - 1]!.release || 'the latest safe release') : 'main';
    const safeLine = safe.length ? `Already safe: ${safe.map((x) => x.name + (x.release ? ' (' + x.release + ')' : '')).join(', ')}\n` : '';
    const steps = hit.map((x, i) => `${i + 1}. Promote ${release} to ${x.name} (now ${x.release || 'unknown'}), fix by ${dueText(run.firedAt, x.slaHours)}`).join('\n');
    return `Deploy request for ${r.repoName} (${inc.id})\n\nMain already has ${r.main!.dep.name}@${r.main!.dep.version}.\n${safeLine}\n${steps}\n${hit.length + 1}. Re-scan the deployed release.`;
  }
  const d = r.main!.dep, fx = fixedFor(inc.ecosystem, inc.fixed);
  const after = r.envs.filter((x) => x.state === 'affected').map((x) => `${x.name}, fix by ${dueText(run.firedAt, x.slaHours)}`).join('; ') || 'next normal release';
  return `PR #${st.pr}: Bump ${d.name} to ${fx} (${inc.id})\nBranch: bloodhound/${inc.id.toLowerCase()}\n\nRecipe: ${g.label}, v${st.recipeVersion}\n${rec.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\nBreaking changes: ${rec.breaking}\nTests: ${({ good: 'good', some: 'partial', none: 'no' } as const)[r.tests]} coverage\n\nAfter merge, roll out to: ${after}`;
}

export function ticketText(run: Run, r: RepoResult, g: Group | null): string {
  const inc = run.incident, st = run.repoState[r.repoId]!;
  const due = r.sla ? dueText(run.firedAt, r.sla.hours) : dueText(run.firedAt, null);
  const attempts = st.log.map((l) => '- ' + l).join('\n') || '- none';
  const manual = (g ? g.recipe.steps : []).map((s) => '- [ ] ' + s).join('\n');
  const extra = r.tests === 'none' ? `\n- [ ] Add tests that cover the ${inc.package} call sites` : '';
  return `Title: [ESCALATED] ${inc.package} in ${r.repoName} (${inc.id}, ${inc.severity})
Project: ${r.projectName}, owner ${r.owner}
Reason: ${st.reason}
Deadline: ${due}${r.sla ? ' in ' + r.sla.env : ''}
Recipe: ${g ? g.label + ', v' + (st.recipeVersion ?? g.recipe.version) : 'none'}

Attempts:
${attempts}

Manual steps:
${manual}${extra}
- [ ] Re-run Bloodhound for ${inc.id} to verify`;
}

/** The webhook payload in OSV style. This is exactly what the incident lab previews. */
export function payload(inc: Incident, now: number): Record<string, unknown> {
  const events: Record<string, string>[] = [{ introduced: inc.introduced || '0' }];
  if (inc.fixed) events.push({ fixed: inc.fixed });
  return {
    id: inc.id,
    summary: inc.summary,
    details: inc.details,
    published: new Date(now).toISOString().slice(0, 19) + 'Z',
    database_specific: { severity: inc.severity.toUpperCase() },
    affected: [{ package: { ecosystem: inc.ecosystem, name: inc.package }, ranges: [{ type: 'ECOSYSTEM', events }] }],
  };
}

/** Reads an OSV-style payload back into an incident. Throws a readable error when a field is missing. */
export function incidentFromPayload(p: unknown): Incident {
  const o = p as Record<string, any>;
  const aff = o?.affected?.[0];
  const pkg = aff?.package;
  const range = aff?.ranges?.[0];
  if (!o?.id || !pkg?.name || !pkg?.ecosystem) throw new Error('The payload needs id, affected[0].package.name and affected[0].package.ecosystem.');
  const sev = String(o.database_specific?.severity ?? '').toLowerCase() as Sev;
  if (!(SEVS as string[]).includes(sev)) throw new Error('database_specific.severity must be critical, high, medium or low.');
  if (!(ECOS as string[]).includes(pkg.ecosystem)) throw new Error(`Unknown ecosystem ${pkg.ecosystem}.`);
  const events: Record<string, string>[] = range?.events ?? [];
  const introduced = String(events.find((e) => 'introduced' in e)?.introduced ?? '0');
  const fixed = String(events.find((e) => 'fixed' in e)?.fixed ?? '');
  return {
    id: String(o.id), severity: sev, ecosystem: pkg.ecosystem as Eco, package: String(pkg.name),
    introduced, fixed, summary: String(o.summary ?? ''), details: String(o.details ?? ''),
  };
}
