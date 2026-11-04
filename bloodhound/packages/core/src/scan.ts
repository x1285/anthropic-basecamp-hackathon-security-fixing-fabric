import { compareVersions, isPinned } from './semver';
import { isAffected, type Incident } from './osv';

export interface ScanRepo {
  id: string;
  projectId: string;
  direct: string[];
  /** Declared ranges from package.json (direct deps only). */
  declared: Record<string, string>;
  /** Resolved versions on main, from the lockfile. */
  lock: Record<string, string>;
}

export interface ScanEnv {
  id: string;
  projectId: string;
  /** Resolved versions per repo as deployed in this environment. */
  versions: Record<string, Record<string, string>>;
}

export interface Finding {
  repoId: string;
  /** 'main' or the environment id. */
  scope: string;
  envId: string | null;
  packageName: string;
  version: string;
  affected: boolean;
  unpinned: boolean;
  direct: boolean;
}

/**
 * Environment-aware scan: checks main and every environment where the repo is deployed.
 * Only the incident's package is looked at.
 */
export function scanRepos(incident: Incident, repos: ScanRepo[], envs: ScanEnv[]): Finding[] {
  const out: Finding[] = [];
  for (const repo of repos) {
    const mainVer = repo.lock[incident.packageName];
    if (mainVer !== undefined) out.push(finding(repo, incident, 'main', null, mainVer));
    for (const env of envs) {
      if (env.projectId !== repo.projectId) continue;
      const deployed = env.versions[repo.id]?.[incident.packageName];
      if (deployed !== undefined) out.push(finding(repo, incident, env.id, env.id, deployed));
    }
  }
  return out;
}

function finding(repo: ScanRepo, incident: Incident, scope: string, envId: string | null, version: string): Finding {
  const direct = repo.direct.includes(incident.packageName);
  const declared = repo.declared[incident.packageName];
  return {
    repoId: repo.id,
    scope,
    envId,
    packageName: incident.packageName,
    version,
    affected: isAffected(incident, version, compareVersions),
    unpinned: direct && declared !== undefined && !isPinned(declared),
    direct,
  };
}

/** Repos and environments that have at least one affected finding. */
export function affectedSummary(findings: Finding[]): { repoIds: string[]; envIds: string[] } {
  const hit = findings.filter((f) => f.affected);
  return {
    repoIds: [...new Set(hit.map((f) => f.repoId))].sort(),
    envIds: [...new Set(hit.map((f) => f.envId).filter((x): x is string => x !== null))].sort(),
  };
}
