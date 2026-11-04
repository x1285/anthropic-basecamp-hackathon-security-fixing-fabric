import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  satisfies,
  isPinned,
  parseOsv,
  scanRepos,
  affectedSummary,
  effectiveSla,
  slaStatus,
  groupFindings,
  complexityFor,
  choosePilot,
  rankRepos,
  type ScanRepo,
  type ScanEnv,
} from '../src/index.js';

const jwtIncident = parseOsv({
  id: 'OSV-T-1',
  database_specific: { severity: 'CRITICAL' },
  detectedAt: '2026-11-04T08:00:00Z',
  affected: [{ package: { ecosystem: 'npm', name: 'jsonwebtoken' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '9.0.0' }] }] }],
});

describe('semver', () => {
  it('compares versions numerically, not lexically', () => {
    expect(compareVersions('9.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('4.17.21', '4.17.21')).toBe(0);
  });
  it('checks comparator ranges', () => {
    expect(satisfies('9.0.2', '>=9.0.0')).toBe(true);
    expect(satisfies('8.5.1', '>=9.0.0')).toBe(false);
    expect(satisfies('8.5.1', '>=8.0.0,<9.0.0')).toBe(true);
  });
  it('treats only exact versions as pinned', () => {
    expect(isPinned('8.5.1')).toBe(true);
    expect(isPinned('^8.5.1')).toBe(false);
  });
});

describe('scan (environment-aware)', () => {
  const repos: ScanRepo[] = [
    { id: 'shop-api', projectId: 'webshop', direct: ['jsonwebtoken'], declared: { jsonwebtoken: '8.5.1' }, lock: { jsonwebtoken: '9.0.0' } },
    { id: 'shop-web', projectId: 'webshop', direct: ['jsonwebtoken'], declared: { jsonwebtoken: '^8.5.1' }, lock: { jsonwebtoken: '8.5.1' } },
  ];
  const envs: ScanEnv[] = [
    { id: 'webshop-prod', projectId: 'webshop', versions: { 'shop-api': { jsonwebtoken: '8.5.1' }, 'shop-web': { jsonwebtoken: '8.5.1' } } },
  ];

  it('flags deployed versions that differ from main', () => {
    const findings = scanRepos(jwtIncident, repos, envs);
    const summary = affectedSummary(findings);
    expect(summary.repoIds).toEqual(['shop-api', 'shop-web']);
    expect(summary.envIds).toEqual(['webshop-prod']);
  });

  it('flags unpinned direct ranges for a manual check', () => {
    const findings = scanRepos(jwtIncident, repos, envs);
    expect(findings.find((f) => f.repoId === 'shop-web' && f.scope === 'main')?.unpinned).toBe(true);
    expect(findings.find((f) => f.repoId === 'shop-api' && f.scope === 'main')?.unpinned).toBe(false);
  });
});

describe('SLA', () => {
  it('uses the strictest customer SLA of an environment', () => {
    const sla = effectiveSla('CRITICAL', [
      { id: 'gold', slaHours: { CRITICAL: 24 } },
      { id: 'std', slaHours: { CRITICAL: 72 } },
    ], 48);
    expect(sla).toEqual({ hours: 24, source: 'customers', strictestCustomerId: 'gold' });
  });

  it('falls back to the environment floor without customers', () => {
    expect(effectiveSla('CRITICAL', [], 72)).toEqual({ hours: 72, source: 'floor' });
  });

  it('starts the clock at detection and raises the alarm at half the SLA without a tested PR', () => {
    const detected = new Date('2026-11-04T08:00:00Z');
    const now = new Date('2026-11-04T20:00:00Z'); // 12h of a 24h SLA
    const s = slaStatus(detected, 24, now, 0.5, false);
    expect(s.elapsedFraction).toBeCloseTo(0.5);
    expect(s.alarm).toBe(true);
    expect(slaStatus(detected, 24, now, 0.5, true).alarm).toBe(false);
  });
});

describe('grouping', () => {
  it('groups by signature and separates direct from transitive dependencies', () => {
    const repos = new Map<string, ScanRepo>([
      ['a', { id: 'a', projectId: 'p', direct: ['jsonwebtoken'], declared: {}, lock: {} }],
      ['b', { id: 'b', projectId: 'p', direct: [], declared: {}, lock: {} }],
    ]);
    const findings = [
      { repoId: 'a', scope: 'main', envId: null, packageName: 'jsonwebtoken', version: '8.5.1', affected: true, unpinned: false, direct: true },
      { repoId: 'b', scope: 'main', envId: null, packageName: 'jsonwebtoken', version: '8.5.0', affected: true, unpinned: false, direct: false },
    ];
    const groups = groupFindings(jwtIncident, findings, repos);
    expect(groups).toHaveLength(2);
  });

  it('does not group incidents without a fixed version', () => {
    const noFix = parseOsv({ id: 'X', affected: [{ package: { ecosystem: 'npm', name: 'pdf-parse-lite' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }] }] });
    expect(groupFindings(noFix, [], new Map())).toEqual([]);
  });

  it('rates a jump over two majors as L', () => {
    expect(complexityFor(jwtIncident, '7.4.0', 'direct', 1)).toBe('L');
    expect(complexityFor(jwtIncident, '8.5.1', 'direct', 0)).toBe('S');
    expect(complexityFor(jwtIncident, '8.5.1', 'transitive', 0)).toBe('M');
  });
});

describe('priority', () => {
  it('ranks repos by deadline first, then complexity', () => {
    const ranked = rankRepos([
      { repoId: 'x', remainingHours: 40, complexity: 'S', customers: 1, hasTests: true },
      { repoId: 'y', remainingHours: 10, complexity: 'L', customers: 1, hasTests: true },
    ]);
    expect(ranked[0].repoId).toBe('y');
  });

  it('pilots the safest repo unless the deadline is tight', () => {
    const repos = [
      { repoId: 'urgent', remainingHours: 5, complexity: 'M' as const, customers: 1, hasTests: true },
      { repoId: 'safe', remainingHours: 40, complexity: 'S' as const, customers: 1, hasTests: true },
    ];
    expect(choosePilot(repos)?.repoId).toBe('urgent');
    expect(choosePilot(repos.map((r) => ({ ...r, remainingHours: 40 })))?.repoId).toBe('safe');
  });
});
