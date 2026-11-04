import { describe, expect, it } from 'vitest';
import {
  applyWorldOp, approveNotice, buildRun, cleanV, effSla, evaluate, fixedFor, incidentFromPayload, inRange, norm,
  parseManifest, payload, PRESETS, rangeText, runNext, runOne, runSummary, priority, seedWorld, verify, waitText,
  type Incident, type Run, type World,
} from '../src/index';

const NOW = Date.UTC(2026, 10, 4, 9, 0, 0);
let seq = 0;
const ids = () => `id-${++seq}`;
const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const inc = (id: string): Incident => PRESETS.find((p) => p.id === id)!;

function runFor(world: World, incident: Incident): Run {
  return buildRun(world, incident, NOW, rng, 'run-test');
}

describe('versions', () => {
  it('reads ranges with and without the fixed bound', () => {
    const jwt = { introduced: '0', fixed: '9.0.0' };
    expect(inRange('8.5.1', jwt)).toBe(true);
    expect(inRange('9.0.2', jwt)).toBe(false);
    expect(inRange('^8.5.1', jwt)).toBe(true);
    expect(inRange('', jwt)).toBeNull();
    expect(inRange('latest', jwt)).toBeNull();
    expect(rangeText({ introduced: '1.0.0', fixed: '1.26.18' })).toBe('>= 1.0.0, < 1.26.18');
    expect(rangeText({ introduced: '0', fixed: '' })).toBe('all versions no fixed version yet');
  });

  it('normalises package names per ecosystem and adds the Go v prefix', () => {
    expect(norm('PyPI', 'Requests_Toolbelt')).toBe('requests-toolbelt');
    expect(norm('npm', 'Lodash')).toBe('lodash');
    expect(fixedFor('Go', '0.17.0')).toBe('v0.17.0');
    expect(cleanV('~4.17.15')).toBe('4.17.15');
  });
});

describe('evaluate', () => {
  it('finds a prod-only vulnerable override and asks for a deploy, not a code change', () => {
    const w = seedWorld();
    const shop = w.projects.find((p) => p.id === 'shop')!;
    const repo = shop.repos.find((r) => r.id === 'checkout-web')!;
    const res = evaluate(repo, shop, inc('DEMO-2026-0101'), w.envs, w.customers);
    expect(res.verdict).toBe('affected');
    expect(res.fix).toBe('deploy');
    expect(res.main!.state).toBe('patched');
    // prod customers: Contoso (high 24 h) is the strictest
    expect(res.sla).toEqual({ env: 'prod', hours: 24, by: 'Contoso' });
  });

  it('uses the environment fallback when no customer is on it', () => {
    const w = seedWorld();
    const shop = w.projects.find((p) => p.id === 'shop')!;
    const dev = w.envs.find((e) => e.id === 'dev')!;
    expect(effSla(shop, 'dev', 'critical', w.envs, w.customers)).toEqual({ hours: dev.sla.critical, by: 'fallback' });
  });

  it('marks a repo clear when it does not depend on the package', () => {
    const w = seedWorld();
    const edge = w.projects.find((p) => p.id === 'edge')!;
    const res = evaluate(edge.repos[0]!, edge, inc('DEMO-2026-0101'), w.envs, w.customers);
    expect(res.verdict).toBe('clear');
    expect(res.note).toBe('Different ecosystem (Go)');
  });
});

describe('build and fix a run', () => {
  it('scans the jsonwebtoken incident across projects and groups the direct bumps', () => {
    const w = seedWorld();
    const run = runFor(w, inc('DEMO-2026-0104'));
    const affected = run.results.filter((r) => r.verdict === 'affected').map((r) => r.repoName).sort();
    expect(affected).toEqual(['checkout-api', 'checkout-web', 'partner-auth', 'partner-portal-web']);
    const direct = run.groups.find((g) => g.key === 'direct|8')!;
    expect(direct.members.length).toBeGreaterThan(0);
    expect(direct.recipe.complexity).toBe('L'); // 8.x -> 9.x is a major jump
    expect(run.notify.status).toBe('pending');
    expect(run.recipients.map((r) => r.id)).toContain('contoso');
  });

  it('runs pilot first, escalates the repo without tests, and verifies a deploy', () => {
    const w = seedWorld();
    const run = runFor(w, inc('DEMO-2026-0104'));
    const pilotGroup = run.groups.find((g) => g.key === 'direct|8')!;
    expect(pilotGroup.pilot!.id).toBe('checkout-web'); // good tests and the tightest deadline with review
    expect(pilotGroup.pilot!.review).toBe(true);
    let guard = 0;
    while (runNext(run) && guard++ < 50);
    expect(run.repoState['checkout-web']!.status).toBe('pr');
    expect(run.repoState['partner-portal-web']!.status).toBe('escalated');
    expect(run.repoState['checkout-api']!.status).toBe('deploy-ready');
    const rec = pilotGroup.recipe;
    expect(rec.confidence).toBe('Validated');
    expect(rec.version).toBeGreaterThan(1);
    verify(run, 'checkout-api');
    expect(run.repoState['checkout-api']!.status).toBe('verified');
    expect(runSummary(run).aff.length).toBeGreaterThan(0);
  });

  it('keeps the queue order stable: pilot before its group', () => {
    const w = seedWorld();
    const run = runFor(w, inc('DEMO-2026-0104'));
    const rows = priority(run);
    const pilotIdx = rows.findIndex((r) => r.role === 'Pilot');
    const restIdx = rows.findIndex((r) => r.role === 'Waits for pilot' || r.role === 'Rollout');
    expect(pilotIdx).toBeGreaterThanOrEqual(0);
    expect(pilotIdx).toBeLessThan(restIdx < 0 ? Infinity : restIdx);
  });

  it('sends the notices only after approval and personalises them locally', () => {
    const w = seedWorld();
    const run = runFor(w, inc('DEMO-2026-0101'));
    expect(run.outbox).toHaveLength(0);
    approveNotice(run, run.notify.subject, run.notify.body, NOW + 5 * 60e3);
    expect(run.notify.status).toBe('approved');
    expect(run.outbox.length).toBe(run.recipients.length + run.unaffected.length);
    expect(run.outbox[0]!.body).toContain('Hello ');
    expect(waitText(run, NOW)).toBe('Approved 5 min after detection.');
  });

  it('a clear run fixes nothing; only opt-in customers get a "not affected" notice', () => {
    const w = seedWorld();
    const run = runFor(w, inc('DEMO-2026-0105'));
    expect(run.results.some((r) => r.verdict === 'affected')).toBe(false);
    expect(run.groups).toHaveLength(0);
    // Northwind and Woodgrove opted in to "not affected" notices and sit on watched projects
    expect(run.unaffected).toEqual(['northwind', 'woodgrove']);
    expect(run.recipients).toHaveLength(0);
    expect(run.notify.status).toBe('pending');
  });

  it('a run without a fix escalates every affected repo', () => {
    const w = seedWorld();
    const noFix: Incident = { ...inc('DEMO-2026-0101'), fixed: '' };
    const run = runFor(w, noFix);
    const affected = run.results.filter((r) => r.verdict === 'affected');
    expect(affected.length).toBeGreaterThan(0);
    for (const r of affected) runOne(run, priority(run).find((x) => x.r.repoId === r.repoId)!);
    expect(affected.every((r) => run.repoState[r.repoId]!.status === 'escalated')).toBe(true);
  });
});

describe('manifests and payloads', () => {
  it('reads package.json, requirements.txt and go.mod', () => {
    expect(parseManifest('{"name":"a","dependencies":{"lodash":"^4.17.15"}}').deps[0]).toMatchObject({ name: 'lodash', direct: true });
    expect(parseManifest('flask==2.0.1\n# comment\nrequests>=2.20').deps.map((d) => d.version)).toEqual(['2.0.1', '>=2.20']);
    expect(parseManifest('module example.com/app\n\nrequire github.com/gin-gonic/gin v1.7.2\n').ecosystem).toBe('Go');
    expect(() => parseManifest('{ broken')).toThrow(/doesn’t parse/);
    expect(() => parseManifest('   ')).toThrow();
  });

  it('round-trips the OSV-style payload into an incident', () => {
    const i = inc('DEMO-2026-0102');
    expect(incidentFromPayload(payload(i, NOW))).toEqual(i);
    expect(() => incidentFromPayload({ id: 'x' })).toThrow(/affected/);
  });
});

describe('world edits', () => {
  it('refuses to remove the last environment and resets tier SLAs', () => {
    const ctx = { newId: ids, rng };
    let w = applyWorldOp(seedWorld(), { type: 'env-remove', envId: 'dev' }, ctx).world;
    w = applyWorldOp(w, { type: 'env-remove', envId: 'staging' }, ctx).world;
    const last = applyWorldOp(w, { type: 'env-remove', envId: 'prod' }, ctx);
    expect(last.error).toBe('At least one environment must remain');
    const tier = applyWorldOp(seedWorld(), { type: 'customer-tier', customerId: 'northwind', tier: 'Gold' }, ctx);
    expect(tier.world.customers.find((c) => c.id === 'northwind')!.sla.critical).toBe(4);
  });

  it('returns an error instead of throwing for a bad manifest', () => {
    const res = applyWorldOp(seedWorld(), { type: 'add-repo-manifest', projectId: 'shop', name: 'x', text: '{ nope' }, { newId: ids, rng });
    expect(res.error).toMatch(/doesn’t parse/);
  });
});
