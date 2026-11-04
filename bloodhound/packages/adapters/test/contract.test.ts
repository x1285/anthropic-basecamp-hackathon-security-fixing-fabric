// Contract tests: every adapter interface is exercised through its fake. Real implementations must pass the same tests (P6).
import { describe, expect, it } from 'vitest';
import { createFakeAdapters } from '../src/index';

describe('adapter contracts (fakes)', () => {
  it('mailer returns an id and records the message', async () => {
    const { mailer, fakes } = createFakeAdapters();
    const res = await mailer.send({ to: 'ops@example.com', subject: 's', body: 'b' });
    expect(res.id).toMatch(/\S+/);
    expect(fakes.mailer.sent).toHaveLength(1);
  });

  it('ticket system returns a stable id per ticket', async () => {
    const { tickets, fakes } = createFakeAdapters();
    const a = await tickets.create({ title: 't', assigneeTeam: 'Team X', body: '', checklist: ['step'] });
    const b = await tickets.create({ title: 't2', assigneeTeam: 'Team X', body: '', checklist: [] });
    expect(a.id).not.toBe(b.id);
    expect(fakes.tickets.tickets).toHaveLength(2);
  });

  it('code host returns a PR number per draft', async () => {
    const { codeHost, fakes } = createFakeAdapters();
    const pr = await codeHost.openPullRequest({ repoId: 'shop-api', title: 'fix', diff: '', checks: [] });
    expect(pr.number).toMatch(/^SIM-PR-/);
    expect(fakes.codeHost.pulls).toHaveLength(1);
  });

  it('deploy source returns the releases it was given', async () => {
    const releases = { 'webshop-prod': { release: 'r1', deployedAt: '2026-10-28T09:00:00Z', versions: {} } };
    const { deploy } = createFakeAdapters(releases);
    expect(await deploy.releases()).toEqual(releases);
  });
});
