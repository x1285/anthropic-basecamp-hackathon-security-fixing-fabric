// Several incidents at once: shared recipes (unique signature) must not break the runs.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { seed, prisma, ingestIncident, MOCKDATA } from '../src/index';

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('bloodhound_test')) throw new Error('tests must run against bloodhound_test (use pnpm test)');
  await seed();
});

describe('parallel incidents (P7 smoke)', () => {
  it('runs four incidents concurrently without losing runs or duplicating recipes', async () => {
    const files = readdirSync(join(MOCKDATA, 'incidents')).filter((f) => f.endsWith('.json'));
    const payloads = [...files, ...files].map((f, i) => ({ ...JSON.parse(readFileSync(join(MOCKDATA, 'incidents', f), 'utf8')), id: `${JSON.parse(readFileSync(join(MOCKDATA, 'incidents', f), 'utf8')).id}-P${i}` }));
    const results = await Promise.allSettled(payloads.map((p) => ingestIncident(p)));
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.map((r) => (r as PromiseRejectedResult).reason?.message)).toEqual([]);
    const runs = await prisma.run.count({ where: { incident: { id: { in: payloads.map((p) => p.id) } } } });
    expect(runs).toBe(payloads.length);
    const recipes = await prisma.recipe.count();
    expect(recipes).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
