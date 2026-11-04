// Small helpers shared by the domain modules.

export const uniq = <T>(a: T[]): T[] => [...new Set(a)];

/** "a", "a and b", "a, b and c". */
export function listText(a: string[]): string {
  return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/** Missing values sort last. Stored values use null, never Infinity, because JSON cannot carry Infinity. */
export const dnum = (v: number | null | undefined): number => (v == null ? Infinity : v);

export const ncmp = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

export function fmtHours(h: number | null | undefined): string {
  return h == null ? 'no SLA' : h < 48 ? h + ' h' : Math.round(h / 24) + ' days';
}

export function fmtDue(ts: number): string {
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dueText(firedAt: number, h: number | null | undefined): string {
  return h == null ? 'no SLA' : `${fmtDue(firedAt + h * 3600e3)} (${fmtHours(h)})`;
}

/** Replaces {key} placeholders; unknown keys stay as they are. */
export function fill(t: string, v: Record<string, string>): string {
  return t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
}

export const TESTS_LABEL = { good: 'good', some: 'partial', none: 'no' } as const;
export const SAFETY = { good: 0, some: 1, none: 2 } as const;
