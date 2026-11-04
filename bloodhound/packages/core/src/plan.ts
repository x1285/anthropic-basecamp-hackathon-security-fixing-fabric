// Grouping (step 4), recipes (step 5) and priority (step 6). All deterministic; the real product would ask a model here.
import { fixedFor, cleanV, parseV } from './versions';
import { custCount, repoDue } from './evaluate';
import type { Complexity, Eco, Group, Incident, PlannedRow, RepoResult, Recipe, Role, Run, Strategy } from './model';
import { SAFETY, TESTS_LABEL, fmtHours, listText, ncmp } from './util';

export type GroupBase = Pick<Group, 'key' | 'strategy' | 'label' | 'major' | 'cur' | 'via'>;

export const FINAL = ['verified', 'escalated'] as const;

function groupOf(r: RepoResult, inc: Incident): GroupBase & { key: string } {
  const pkg = inc.package;
  if (!inc.fixed) return { key: 'nofix', strategy: 'nofix', label: `No fix for ${pkg} yet`, major: null, cur: null, via: null };
  if (r.fix === 'deploy') return { key: 'deploy', strategy: 'deploy', label: 'Deploy only: main already safe', major: null, cur: null, via: null };
  const d = r.main!.dep;
  const major = (parseV(cleanV(d.version)) ?? [0])[0];
  if (d.direct) {
    return { key: `direct|${major}`, strategy: 'bump', label: `Direct ${pkg} ${major}.x`, major, cur: cleanV(d.version), via: null };
  }
  return { key: `via|${d.via}`, strategy: 'override', label: `${pkg} via ${d.via}`, major: null, cur: cleanV(d.version), via: d.via };
}

export function makeGroups(affected: RepoResult[], inc: Incident): Group[] {
  const map = new Map<string, GroupBase & { members: string[] }>();
  for (const r of affected) {
    const g = groupOf(r, inc);
    const entry = map.get(g.key) ?? { ...g, members: [] };
    entry.members.push(r.repoId);
    map.set(g.key, entry);
  }
  return [...map.values()].map((g, i): Group => {
    const names = g.members.map((id) => affected.find((r) => r.repoId === id)!.repoName);
    const rationale: Record<Strategy, string> = {
      deploy: `Main already has a safe ${inc.package} in ${listText(names)}; only older releases are affected, so promoting a newer release fixes it.`,
      bump: `${inc.package} is a direct dependency on ${g.major}.x in ${listText(names)}; the same manifest change applies to each.`,
      override: `${inc.package} only arrives through ${g.via} in ${listText(names)}; the fix is the same override or ${g.via} upgrade everywhere.`,
      nofix: 'No fixed version is published, so every repo needs a mitigation by hand.',
    };
    const confidence: Record<Strategy, number> = { deploy: 0.93, bump: 0.88, override: 0.81, nofix: 0.95 };
    return {
      ...g, id: 'g' + (i + 1), rationale: rationale[g.strategy], confidence: confidence[g.strategy],
      recipe: makeRecipe(g, inc), pilot: null, pilotDone: false, revisions: 0,
    };
  });
}

export function makeRecipe(g: GroupBase & { members?: string[] }, inc: Incident): Recipe {
  const pkg = inc.package, eco: Eco = inc.ecosystem, fx = fixedFor(eco, inc.fixed);
  let complexity: Complexity = 'M';
  let breaking = '';
  let steps: string[] = [];
  if (g.strategy === 'deploy') {
    complexity = 'S';
    steps = ['Find the newest release that contains main’s safe version', 'Prepare a deploy request for each affected environment', 'After the deploy, re-scan the deployed release'];
    breaking = 'No code change: the release already runs in an earlier environment.';
  } else if (g.strategy === 'nofix') {
    complexity = 'L';
    steps = ['Check the advisory for mitigations', 'Disable or guard the affected feature', 'Watch for a fixed release'];
    breaking = 'Mitigation depends on how each project uses the package.';
  } else {
    const cur = parseV(g.cur) ?? [0, 0, 0], to = parseV(inc.fixed) ?? [0, 0, 0];
    complexity = g.strategy === 'override' ? 'M' : to[0] > cur[0] ? 'L' : to[1] > cur[1] ? 'M' : 'S';
    const bump = g.strategy === 'bump';
    if (eco === 'npm') {
      steps = bump
        ? [`Set "${pkg}": "^${fx}" in package.json`, 'Run npm install to refresh package-lock.json']
        : [`Add "overrides": { "${pkg}": "${fx}" } to package.json`, 'Run npm install to refresh package-lock.json', `Check that ${g.via} still works with ${pkg} ${fx}`];
    } else if (eco === 'PyPI') {
      steps = bump
        ? [`Set ${pkg}==${fx} in requirements.txt`, 'Reinstall into a clean virtualenv']
        : [`Pin ${pkg}>=${fx} in requirements.txt`, `Check that ${g.via} accepts the pinned version`];
    } else {
      steps = [`go get ${pkg}@${fx}`, 'go mod tidy'];
    }
    steps.push('Build and run the test suite', 'Re-scan: dependency outside the affected range', 'Open a PR with the recipe and test results');
    breaking = complexity === 'L'
      ? (pkg === 'jsonwebtoken'
        ? 'jsonwebtoken 9 removes insecure defaults: verify() calls need an explicit algorithms list.'
        : `Major update from ${g.cur} to ${fx}: check the changelog for removed defaults and changed signatures.`)
      : g.strategy === 'override'
        ? `Overriding a transitive version can break ${g.via} if it relies on old behaviour.`
        : 'Patch or minor update; no breaking changes expected.';
  }
  const label: Record<Strategy, string> = { deploy: 'Deploy only', nofix: 'No fix available', bump: 'Version bump', override: 'Override or pin' };
  return {
    strategy: label[g.strategy],
    complexity,
    steps,
    breaking,
    verify: g.strategy === 'deploy'
      ? ['The deployed release is re-scanned as safe in every affected environment']
      : ['Build passes', 'Tests pass', 'Re-scan shows the dependency outside the affected range'],
    confidence: g.strategy === 'deploy' ? 'Validated' : 'Draft',
    version: 1,
    learnings: [],
  };
}

/**
 * Pilot for a group. Normally the safest representative (good tests first, fewest customers).
 * When the deadline is tighter than twice the expected fix time, the most urgent repo is the pilot and needs review.
 */
export function choosePilot(g: Group, run: Pick<Run, 'results'>): Group['pilot'] {
  if (g.strategy === 'deploy' || g.strategy === 'nofix') return null;
  const ms = g.members.map((id) => run.results.find((r) => r.repoId === id)!);
  const exp = ({ S: 1, M: 2, L: 4 } as const)[g.recipe.complexity];
  const tight = Math.min(...ms.map(repoDue));
  if (tight < 2 * exp) {
    const b = [...ms].sort((a, c) => ncmp(repoDue(a), repoDue(c)) || SAFETY[a.tests] - SAFETY[c.tests])[0]!;
    return {
      id: b.repoId, review: true,
      reason: `The ${fmtHours(tight)} deadline leaves less than twice the expected fix time of ${exp} h, so the most urgent repo is the pilot and its PR needs human review.`,
    };
  }
  const b = [...ms].sort((a, c) => SAFETY[a.tests] - SAFETY[c.tests] || custCount(a) - custCount(c) || ncmp(repoDue(c), repoDue(a)))[0]!;
  const n = custCount(b);
  return {
    id: b.repoId, review: false,
    reason: `Safest representative repo: ${TESTS_LABEL[b.tests]} tests, ${n} customer${n === 1 ? '' : 's'} affected.`,
  };
}

export function roleOf(g: Group, r: RepoResult): Role {
  if (g.strategy === 'deploy') return 'Deploy';
  if (g.strategy === 'nofix') return 'Manual';
  if (g.pilot && g.pilot.id === r.repoId) return 'Pilot';
  return g.pilotDone ? 'Rollout' : 'Waits for pilot';
}

/** Repos in fix order: groups by deadline, then the pilot first inside its group. Recomputed after every repo. */
export function priority(run: Run): PlannedRow[] {
  const R = (id: string) => run.results.find((r) => r.repoId === id)!;
  const groups = run.groups.map((g) => ({ g, ms: g.members.map(R) }));
  groups.sort((a, b) =>
    ncmp(Math.min(...a.ms.map(repoDue)), Math.min(...b.ms.map(repoDue)))
    || b.ms.reduce((n, r) => n + custCount(r), 0) - a.ms.reduce((n, r) => n + custCount(r), 0));
  const rows: PlannedRow[] = [];
  for (const { g, ms } of groups) {
    const pilotId = g.pilot?.id;
    ms.sort((a, b) =>
      (pilotId && a.repoId === pilotId ? -1 : pilotId && b.repoId === pilotId ? 1 : 0)
      || ncmp(repoDue(a), repoDue(b)) || custCount(b) - custCount(a));
    for (const r of ms) rows.push({ r, g, role: roleOf(g, r), st: run.repoState[r.repoId]! });
  }
  return rows;
}

export const eligible = (row: PlannedRow): boolean => row.st.status === 'queued' && row.role !== 'Waits for pilot';
