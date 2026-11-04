// Integration smoke tests against the Postgres test database (DATABASE_URL from .env.test).
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seed, prisma, ingestIncident, approveMessage, mergeAndDeploy, MOCKDATA } from '../src/index.js';

const incident = (n: string) => JSON.parse(readFileSync(join(MOCKDATA, 'incidents', n), 'utf8'));
const files = {
  jwt: '01-OSV-2026-1001.json',
  lodash: '02-OSV-2026-1002.json',
  jwtAgain: '03-OSV-2026-1003.json',
  pdf: '04-OSV-2026-1004.json',
};

beforeAll(async () => {
  // seed() wipes all Bloodhound tables: only ever against the test database.
  if (!process.env.DATABASE_URL?.includes("bloodhound_test")) throw new Error("tests must run against bloodhound_test (use pnpm test)");
  await seed();
});

describe('incident run: webhook to fixes', () => {
  let runId = '';

  it('scans main and deployed releases and finds the six affected repos', async () => {
    ({ runId } = await ingestIncident(incident(files.jwt)));
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { repoStates: true } });
    const repos = run.repoStates.map((s) => s.repoId).sort();
    expect(repos).toEqual(['billing-api', 'billing-worker', 'legacy-cms', 'portal-auth', 'shop-api', 'shop-web']);
  });

  it('uses the strictest customer SLA, and the environment floor where no customer is attached', async () => {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    const sla = run.slaByEnv as Record<string, { hours: number; source: string }>;
    expect(sla['webshop-prod'].hours).toBe(24); // gold customer, CRITICAL
    expect(sla['billing-staging']).toMatchObject({ source: 'floor', hours: 72 });
  });

  it('groups into two distinct fixes and creates the recipe', async () => {
    const groups = await prisma.group.findMany({ where: { runId } });
    expect(groups.map((g) => g.strategy).sort()).toEqual(['direct', 'transitive']);
  });

  it('opens simulated PRs for green repos and escalates the repo at the attempt limit', async () => {
    const prs = await prisma.pullRequest.findMany({ where: { runId } });
    expect(prs.map((p) => p.repoId).sort()).toEqual(['billing-api', 'billing-worker', 'portal-auth', 'shop-api', 'shop-web']);
    const esc = await prisma.escalation.findMany({ where: { runId } });
    expect(esc.map((e) => e.repoId)).toEqual(['legacy-cms']);
    expect(esc[0].reason).toContain('attempt limit');
  });

  it('keeps the customer notice pending until approved, then fans out to customers on affected environments', async () => {
    const notice = await prisma.message.findFirstOrThrow({ where: { runId, kind: 'incident_notice' } });
    expect(notice.status).toBe('pending');
    const { copies } = await approveMessage(notice.id, 'simulated-approver');
    expect(copies).toBeGreaterThan(0);
    const outbox = await prisma.message.count({ where: { runId, kind: 'outbox_copy' } });
    expect(outbox).toBe(copies);
  });

  it('closes repos only after merge and re-scan; the run waits for the resolution notice', async () => {
    const prs = await prisma.pullRequest.findMany({ where: { runId } });
    for (const pr of prs) {
      const res = await mergeAndDeploy(pr.id, 'simulated-operator');
      expect(res.verified).toBe(true);
    }
    const states = await prisma.repoState.findMany({ where: { runId } });
    expect(states.filter((s) => s.status === 'fixed')).toHaveLength(prs.length);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe('awaiting_resolution');
  });

  it('reuses the recipe from memory for the same signature in a second incident', async () => {
    const { runId: second } = await ingestIncident(incident(files.jwtAgain));
    const groups = await prisma.group.findMany({ where: { runId: second } });
    expect(groups.some((g) => g.rationale.includes('reused from memory'))).toBe(true);
  });
});

describe('edge cases', () => {
  it('escalates immediately when no fixed version exists', async () => {
    const { runId } = await ingestIncident(incident(files.pdf));
    const esc = await prisma.escalation.findMany({ where: { runId } });
    expect(esc.map((e) => e.repoId)).toEqual(['reports-service']);
    expect(esc[0].reason).toBe('no fixed version exists');
  });

  it('scans lodash per environment: staging runs an old version, main is fine', async () => {
    const { runId } = await ingestIncident(incident(files.lodash));
    const states = await prisma.repoState.findMany({ where: { runId } });
    expect(states.map((s) => s.repoId).sort()).toEqual(['logistics-notify', 'logistics-tracker']);
  });
});
