import type { Incident } from './osv';
import { majorOf } from './semver';
import type { Finding, ScanRepo } from './scan';

export type Strategy = 'direct' | 'transitive';
export type Complexity = 'S' | 'M' | 'L';

export interface Group {
  signature: string;
  strategy: Strategy;
  repoIds: string[];
  envIds: string[];
}

/** Deterministic fix signature: same package, same target, same way the dependency is pulled in. */
export function fixSignature(incident: Incident, strategy: Strategy): string {
  return `${incident.packageName}|${incident.fixedVersion ?? 'none'}|${strategy}`;
}

export function strategyFor(repo: ScanRepo, packageName: string): Strategy {
  return repo.direct.includes(packageName) ? 'direct' : 'transitive';
}

/** S = direct bump without code checks, M = transitive or code checks, L = jump over 2+ majors. */
export function complexityFor(incident: Incident, currentVersion: string, strategy: Strategy, codeChecks: number): Complexity {
  if (incident.fixedVersion !== null && majorOf(incident.fixedVersion) - majorOf(currentVersion) >= 2) return 'L';
  if (strategy === 'transitive' || codeChecks > 0) return 'M';
  return 'S';
}

/** Groups affected findings by signature. Incidents without a fix version are not grouped here. */
export function groupFindings(incident: Incident, findings: Finding[], repos: Map<string, ScanRepo>): Group[] {
  if (incident.fixedVersion === null) return [];
  const groups = new Map<string, Group>();
  for (const f of findings) {
    if (!f.affected) continue;
    const repo = repos.get(f.repoId);
    if (!repo) continue;
    const strategy = strategyFor(repo, incident.packageName);
    const signature = fixSignature(incident, strategy);
    const g = groups.get(signature) ?? { signature, strategy, repoIds: [], envIds: [] };
    if (!g.repoIds.includes(f.repoId)) g.repoIds.push(f.repoId);
    if (f.envId && !g.envIds.includes(f.envId)) g.envIds.push(f.envId);
    groups.set(signature, g);
  }
  return [...groups.values()].map((g) => ({ ...g, repoIds: g.repoIds.sort(), envIds: g.envIds.sort() }));
}
