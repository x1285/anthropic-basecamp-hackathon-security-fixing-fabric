// Minimal semver: major.minor.patch comparisons, pre-release ignored.
export type Version = [number, number, number];

export function parseVersion(v: string): Version {
  const core = v.trim().replace(/^[v=]/, '').split(/[-+]/)[0];
  const parts = core.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] < vb[i] ? -1 : 1;
  }
  return 0;
}

export function majorOf(v: string): number {
  return parseVersion(v)[0];
}

/** Checks comparator set such as ">=9.0.0" or "<9.0.0". Comma separates AND-ed comparators. */
export function satisfies(version: string, range: string): boolean {
  return range
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .every((c) => {
      const m = c.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
      if (!m) return false;
      const cmp = compareVersions(version, m[2]);
      switch (m[1] ?? '=') {
        case '>=': return cmp >= 0;
        case '<=': return cmp <= 0;
        case '>': return cmp > 0;
        case '<': return cmp < 0;
        default: return cmp === 0;
      }
    });
}

/** A declared range is pinned when it is an exact version. */
export function isPinned(declaredRange: string): boolean {
  return /^\d+\.\d+(\.\d+)?$/.test(declaredRange.trim());
}
