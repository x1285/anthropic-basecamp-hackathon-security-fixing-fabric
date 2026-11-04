// Version and range helpers, ported from the target UI. Ranges are introduced (inclusive) and fixed (exclusive).
import type { Eco, Incident, MatchState } from './model';

export type Ver = [number, number, number];

export function parseV(v: string | null | undefined): Ver | null {
  const m = String(v ?? '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [+m[1]!, +(m[2] ?? 0), +(m[3] ?? 0)] : null;
}

export function cmpV(a: Ver, b: Ver): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1;
  return 0;
}

/** Strips range operators such as ^ or ~ so "^4.17.15" reads as 4.17.15. */
export function cleanV(v: string | null | undefined): string {
  return String(v ?? '').replace(/^[\^~<>=!\s]+/, '').trim();
}

/** Package names: lowercase everywhere, PyPI also folds _ and . into -. */
export function norm(eco: Eco, name: string): string {
  const n = name.trim().toLowerCase();
  return eco === 'PyPI' ? n.replace(/[-_.]+/g, '-') : n;
}

/** true = inside the affected range, false = outside, null = cannot tell (unpinned or unreadable). */
export function inRange(version: string, inc: Pick<Incident, 'introduced' | 'fixed'>): boolean | null {
  if (/^\s*(>|<|!=|\*|latest)/i.test(String(version))) return null;
  const v = parseV(cleanV(version));
  if (!v) return null;
  const lo = parseV(inc.introduced) ?? [0, 0, 0];
  if (cmpV(v, lo) < 0) return false;
  const hi = parseV(inc.fixed);
  if (hi && cmpV(v, hi) >= 0) return false;
  return true;
}

export function rangeText(inc: Pick<Incident, 'introduced' | 'fixed'>): string {
  const lo = parseV(inc.introduced);
  const hasLo = lo !== null && cmpV(lo, [0, 0, 0]) > 0;
  const parts: string[] = [];
  if (hasLo) parts.push('>= ' + inc.introduced);
  parts.push(inc.fixed ? '< ' + inc.fixed : 'no fixed version yet');
  return (hasLo ? '' : 'all versions ') + parts.join(', ');
}

/** Go module versions carry a leading v; the advisory may omit it. */
export function fixedFor(eco: Eco, f: string): string {
  return eco === 'Go' && f && !f.startsWith('v') ? 'v' + f : f;
}

export function matchRank(s: MatchState | 'none' | 'clear'): number {
  return ({ affected: 0, unknown: 1, patched: 2, clear: 3, none: 4 } as const)[s];
}
