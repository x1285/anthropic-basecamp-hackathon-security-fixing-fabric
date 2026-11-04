// Ranking of groups and repos. Recalculate after every repo, since deadlines and states change.
import type { Complexity } from './grouping';

export interface RankRepo {
  repoId: string;
  remainingHours: number; // tightest remaining SLA over its affected environments
  complexity: Complexity;
  customers: number;
  hasTests: boolean;
}

const COMPLEXITY_ORDER: Record<Complexity, number> = { S: 0, M: 1, L: 2 };

/** Repos: deadline first, then complexity, then customers. */
export function rankRepos<T extends RankRepo>(repos: T[]): T[] {
  return [...repos].sort(
    (a, b) =>
      a.remainingHours - b.remainingHours ||
      COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity] ||
      b.customers - a.customers ||
      a.repoId.localeCompare(b.repoId),
  );
}

export interface RankGroup {
  signature: string;
  remainingHours: number;
  customers: number;
}

/** Groups: tightest deadline first, then customers. */
export function rankGroups(groups: RankGroup[]): RankGroup[] {
  return [...groups].sort(
    (a, b) => a.remainingHours - b.remainingHours || b.customers - a.customers || a.signature.localeCompare(b.signature),
  );
}

/**
 * Pilot choice: the safest representative repo (lowest complexity, has tests).
 * The most urgent repo pilots only when its remaining SLA is at most `tightHours`.
 */
export function choosePilot<T extends RankRepo>(repos: T[], tightHours = 12): T | undefined {
  if (repos.length === 0) return undefined;
  const ranked = rankRepos(repos);
  if (ranked[0].remainingHours <= tightHours) return ranked[0];
  const safe = repos
    .filter((r) => r.hasTests)
    .sort((a, b) => COMPLEXITY_ORDER[a.complexity] - COMPLEXITY_ORDER[b.complexity] || a.repoId.localeCompare(b.repoId));
  return safe[0] ?? ranked[0];
}
