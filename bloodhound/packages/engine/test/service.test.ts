// Integration tests against the Postgres test database. seedDatabase() wipes the Bloodhound tables: only run via `pnpm test`.
import { beforeAll, describe, expect, it } from 'vitest';
import { PRESETS, payload } from '@bloodhound/core';
import { fireFromPayload, loadState, mutate, seedDatabase, disconnect } from '../src/index';

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.includes('bloodhound_test')) throw new Error('tests must run against bloodhound_test (use pnpm test)');
  await seedDatabase();
});

describe('demo world', () => {
  it('loads the seed of the target UI: 5 projects, 3 environments, 8 customers', async () => {
    const { world } = await loadState();
    expect(world.projects.map((p) => p.name)).toEqual(['Shop', 'Payments', 'Edge', 'Partner portal', 'Marketing']);
    expect(world.envs.map((e) => e.name)).toEqual(['dev', 'staging', 'prod']);
    expect(world.customers).toHaveLength(8);
    expect(world.projects[0]!.envs.prod!.customers).toEqual(['contoso', 'fabrikam', 'northwind']);
  });

  it('edits go through the core rules and come back as errors, not exceptions', async () => {
    const res = await mutate({ type: 'remove-repo', repoId: 'does-not-exist' });
    expect(res.error).toBe('Unknown repo');
    const ok = await mutate({ type: 'watch', repoId: 'marketing-site', watched: true });
    expect(ok.error).toBeUndefined();
    expect(ok.state.world.projects[4]!.repos[0]!.watched).toBe(true);
    await mutate({ type: 'watch', repoId: 'marketing-site', watched: false });
  });
});

describe('incident run', () => {
  let runId = '';

  it('fires the jsonwebtoken preset and stores the scan', async () => {
    const res = await mutate({ type: 'fire', incident: PRESETS[0]! });
    expect(res.error).toBeUndefined();
    runId = res.runId!;
    const run = res.state.runs[0]!;
    expect(run.id).toBe(runId);
    const affected = run.results.filter((r) => r.verdict === 'affected').map((r) => r.repoName).sort();
    expect(affected).toEqual(['checkout-api', 'checkout-web', 'partner-auth', 'partner-portal-web']);
    expect(run.notify.status).toBe('pending');
  });

  it('keeps customer texts pending until approved, then sends once', async () => {
    const first = await mutate({ type: 'approve-notify', runId, subject: 'S', body: 'Hello {customer}' });
    expect(first.error).toBeUndefined();
    const run = first.state.runs.find((r) => r.id === runId)!;
    expect(run.notify.status).toBe('approved');
    expect(run.outbox.length).toBeGreaterThan(0);
    expect(run.outbox[0]!.body.startsWith('Hello ')).toBe(true);
    const again = await mutate({ type: 'approve-notify', runId, subject: 'S', body: 'B' });
    expect(again.error).toBe('The advisory is already approved.');
  });

  it('runs the fixes, verifies the deploy requests and PRs, then approves the resolution', async () => {
    let res = await mutate({ type: 'run-all', runId });
    expect(res.error).toBeUndefined();
    let run = res.state.runs.find((r) => r.id === runId)!;
    expect(run.repoState['checkout-web']!.status).toBe('pr');
    expect(run.repoState['partner-portal-web']!.status).toBe('escalated');
    for (const [repoId, st] of Object.entries(run.repoState)) {
      if (st.status === 'pr' || st.status === 'deploy-ready') {
        res = await mutate({ type: 'verify', runId, repoId });
        expect(res.error).toBeUndefined();
      }
    }
    run = res.state.runs.find((r) => r.id === runId)!;
    const sent = await mutate({ type: 'approve-resolution', runId, subject: 'R', body: 'Resolved for {customer}' });
    expect(sent.error).toBeUndefined();
    const after = sent.state.runs.find((r) => r.id === runId)!;
    expect(after.resolution.sent).toContain('contoso');
  });

  it('a verify on an escalated repo is refused', async () => {
    const res = await mutate({ type: 'verify', runId, repoId: 'partner-portal-web' });
    expect(res.error).toMatch(/Only an open PR/);
  });
});

describe('webhook', () => {
  it('turns an OSV-style payload into a run', async () => {
    const res = await fireFromPayload(payload(PRESETS[1]!, Date.now()));
    expect(res.runId).toBeTruthy();
    expect(res.state.runs[0]!.incident.package).toBe('lodash');
  });

  it('rejects a payload without a package', async () => {
    await expect(fireFromPayload({ id: 'x' })).rejects.toThrow(/affected/);
  });
});

describe('reset', () => {
  it('restores the seed and clears the runs', async () => {
    const res = await mutate({ type: 'reset' });
    expect(res.state.runs).toHaveLength(0);
    expect(res.state.world.projects).toHaveLength(5);
  });
});

describe('cleanup', () => {
  it('disconnects', async () => {
    await disconnect();
  });
});
