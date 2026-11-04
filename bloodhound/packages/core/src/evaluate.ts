// Scan and SLA: judges every watched repo against one incident, per main and per deployed environment.
import { inRange, matchRank, norm } from './versions';
import type {
  Customer, Dep, Environment, EnvResult, Incident, Match, MatchState, Project, Repo, RepoResult, RepoVerdict, Sev,
} from './model';
import { listText, uniq } from './util';

/** Version of a dependency in one environment: its override, or main's version. */
export const verIn = (d: Dep, envId: string): string => d.env?.[envId] || d.version;

export function envCustomers(p: Project, envId: string): string[] {
  return p.envs[envId]?.customers ?? [];
}

/**
 * Effective SLA of one environment for one severity: the strictest customer SLA on it.
 * Without customers the environment's fallback applies.
 */
export function effSla(
  p: Project, envId: string, sev: Sev, envs: Environment[], custs: Customer[],
): { hours: number | null; by: string | null } {
  let best: { hours: number; by: string } | null = null;
  for (const id of envCustomers(p, envId)) {
    const c = custs.find((x) => x.id === id);
    const h = c?.sla[sev] ?? null;
    if (c && h !== null && (!best || h < best.hours)) best = { hours: h, by: c.name };
  }
  if (best) return best;
  const e = envs.find((x) => x.id === envId);
  const h = e ? (e.sla[sev] ?? null) : null;
  return { hours: h, by: h === null ? null : 'fallback' };
}

function judge(hits: Dep[], inc: Incident, getV: (d: Dep) => string): { state: MatchState; dep: Match } {
  const ms: Match[] = hits.map((d) => {
    const version = getV(d);
    const r = inRange(version, inc);
    return { name: d.name, direct: d.direct, via: d.via, version, state: r === null ? 'unknown' : r ? 'affected' : 'patched' };
  });
  ms.sort((a, b) => matchRank(a.state) - matchRank(b.state));
  return { state: ms[0]!.state, dep: ms[0]! };
}

export function depPath(d: Match): string {
  return d.direct ? 'direct' : 'via ' + d.via;
}

export function evaluate(repo: Repo, p: Project, inc: Incident, envs: Environment[], custs: Customer[]): RepoResult {
  const base = { repoId: repo.id, repoName: repo.name, projectId: p.id, projectName: p.name, owner: p.owner, tests: repo.tests };
  const clear = (note: string): RepoResult => ({ ...base, verdict: 'clear', note, fix: null, main: null, envs: [], sla: null });
  if (repo.ecosystem !== inc.ecosystem) return clear(`Different ecosystem (${repo.ecosystem})`);
  const target = norm(inc.ecosystem, inc.package);
  const hits = repo.deps.filter((d) => norm(repo.ecosystem, d.name) === target);
  if (!hits.length) return clear(`No dependency on ${inc.package}`);

  const main = judge(hits, inc, (d) => d.version);
  const envRes: EnvResult[] = envs.map((e): EnvResult => {
    if (!repo.deployed?.[e.id]) {
      return { env: e.id, name: e.name, release: '', customers: [], slaHours: null, slaBy: null, state: 'none', dep: null };
    }
    const sla = effSla(p, e.id, inc.severity, envs, custs);
    const j = judge(hits, inc, (d) => verIn(d, e.id));
    return {
      env: e.id, name: e.name, release: repo.releases?.[e.id] || '', customers: envCustomers(p, e.id),
      slaHours: sla.hours, slaBy: sla.by, state: j.state, dep: j.dep,
    };
  });

  const verdict = ([main.state, ...envRes.map((x) => x.state)] as const)
    .slice()
    .sort((a, b) => matchRank(a) - matchRank(b))[0] as RepoVerdict;
  const hit = envRes.filter((x) => x.state === 'affected');
  const hitNames = hit.map((x) => x.name);
  let note: string;
  let fix: RepoResult['fix'] = null;
  if (hit.length && main.state !== 'affected') {
    const d = hit[hit.length - 1]!.dep!;
    note = `${listText(hitNames)} still run${hitNames.length === 1 ? 's' : ''} ${d.name}@${d.version}. Main already has ${main.dep.version}, so this needs a deploy, not a code change.`;
    fix = 'deploy';
  } else if (hit.length) {
    note = `${main.dep.name}@${main.dep.version} (${depPath(main.dep)}) is affected on main and in ${listText(hitNames)}.`;
    fix = 'code';
  } else if (main.state === 'affected') {
    note = `Main uses ${main.dep.name}@${main.dep.version}, which is affected, but no deployed environment runs it yet.`;
    fix = 'code';
  } else if (verdict === 'unknown') {
    const unk = envRes.find((x) => x.state === 'unknown');
    const shown = (unk?.dep ?? main.dep).version;
    note = `${main.dep.name} has an unpinned version (“${shown}”). Check the lockfile or the deployed artifact.`;
  } else {
    note = `Uses ${main.dep.name}, but main and every deployed environment are outside the affected range.`;
  }

  let sla: RepoResult['sla'] = null;
  for (const x of hit) {
    if (x.slaHours !== null && (!sla || x.slaHours <= (sla.hours ?? Infinity))) sla = { env: x.name, hours: x.slaHours, by: x.slaBy };
  }
  return { ...base, verdict, note, fix, main, envs: envRes, sla };
}

export const custCount = (r: RepoResult): number =>
  uniq(r.envs.filter((x) => x.state === 'affected').flatMap((x) => x.customers)).length;

/** Hours until the repo's deadline; Infinity when there is none. Only used for ordering. */
export const repoDue = (r: RepoResult): number => (r.sla && r.sla.hours !== null ? r.sla.hours : Infinity);
