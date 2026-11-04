// Persistence on Prisma. The world is stored relationally; a run is stored as one JSON snapshot.
import type { Prisma } from '@prisma/client';
import type { Customer, Environment, Project, Repo, Run, Sla, World, Dep } from '@bloodhound/core';
import { prisma } from './db';

const MAX_RUNS = 20;
const json = (v: unknown) => v as Prisma.InputJsonValue;

const slaFrom = (r: { slaCritical: number | null; slaHigh: number | null; slaMedium: number | null; slaLow: number | null }): Sla => ({
  critical: r.slaCritical, high: r.slaHigh, medium: r.slaMedium, low: r.slaLow,
});
const slaCols = (s: Sla) => ({ slaCritical: s.critical, slaHigh: s.high, slaMedium: s.medium, slaLow: s.low });

export async function loadWorld(): Promise<World> {
  const [envRows, custRows, projRows] = await Promise.all([
    prisma.environment.findMany({ orderBy: { position: 'asc' } }),
    prisma.customer.findMany({ orderBy: { position: 'asc' } }),
    prisma.project.findMany({
      orderBy: { position: 'asc' },
      include: {
        repos: { orderBy: { position: 'asc' }, include: { deps: { orderBy: { position: 'asc' } } } },
        links: { orderBy: { position: 'asc' } },
      },
    }),
  ]);
  const envs: Environment[] = envRows.map((e) => ({
    id: e.id, name: e.name, sla: slaFrom(e), ticket: e.ticket, slack: e.slack, channel: e.channel,
    page: e.page as Environment['page'],
  }));
  const customers: Customer[] = custRows.map((c) => ({
    id: c.id, name: c.name, tier: c.tier as Customer['tier'], sla: slaFrom(c), contact: c.contact, notifyUnaffected: c.notifyUnaffected,
  }));
  const projects: Project[] = projRows.map((p) => {
    const envMap: Project['envs'] = {};
    for (const l of p.links) (envMap[l.envId] ??= { customers: [] }).customers.push(l.customerId);
    const repos: Repo[] = p.repos.map((r) => ({
      id: r.id, name: r.name, ecosystem: r.ecosystem as Repo['ecosystem'], watched: r.watched,
      source: r.source as Repo['source'], tests: r.tests as Repo['tests'],
      deployed: r.deployed as Record<string, boolean>, releases: r.releases as Record<string, string>,
      deps: r.deps.map((d): Dep => ({ name: d.name, version: d.version, direct: d.direct, via: d.via, env: d.env as Record<string, string> })),
    }));
    return { id: p.id, name: p.name, owner: p.owner, repos, envs: envMap };
  });
  return { envs, customers, projects };
}

/** Replaces the whole demo world in one transaction. Cascades clear repos, deps and customer links. */
export async function saveWorld(w: World): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.project.deleteMany();
    await tx.customer.deleteMany();
    await tx.environment.deleteMany();
    await tx.environment.createMany({
      data: w.envs.map((e, i) => ({
        id: e.id, position: i, name: e.name, ...slaCols(e.sla), ticket: e.ticket, slack: e.slack, channel: e.channel, page: e.page,
      })),
    });
    await tx.customer.createMany({
      data: w.customers.map((c, i) => ({
        id: c.id, position: i, name: c.name, tier: c.tier, ...slaCols(c.sla), contact: c.contact, notifyUnaffected: c.notifyUnaffected,
      })),
    });
    for (const [i, p] of w.projects.entries()) {
      await tx.project.create({
        data: {
          id: p.id, position: i, name: p.name, owner: p.owner,
          repos: {
            create: p.repos.map((r, j) => ({
              id: r.id, position: j, name: r.name, ecosystem: r.ecosystem, watched: r.watched, source: r.source, tests: r.tests,
              deployed: json(r.deployed), releases: json(r.releases),
              deps: {
                create: r.deps.map((d, k) => ({ position: k, name: d.name, version: d.version, direct: d.direct, via: d.via, env: json(d.env) })),
              },
            })),
          },
        },
      });
      const links = Object.entries(p.envs).flatMap(([envId, slot]) =>
        slot.customers.map((customerId, k) => ({ projectId: p.id, envId, customerId, position: k })));
      if (links.length) await tx.projectCustomer.createMany({ data: links });
    }
  }, { timeout: 30_000 });
}

export async function loadRuns(): Promise<Run[]> {
  const rows = await prisma.run.findMany({ orderBy: { firedAt: 'desc' }, take: MAX_RUNS });
  return rows.map((r) => r.data as unknown as Run);
}

export async function findRun(id: string): Promise<Run | null> {
  const row = await prisma.run.findUnique({ where: { id } });
  return row ? (row.data as unknown as Run) : null;
}

export async function saveRun(run: Run): Promise<void> {
  await prisma.run.upsert({
    where: { id: run.id },
    create: { id: run.id, firedAt: new Date(run.firedAt), incidentId: run.incident.id, data: json(run) },
    update: { data: json(run) },
  });
  // keep the newest runs only, like the UI does
  const old = await prisma.run.findMany({ orderBy: { firedAt: 'desc' }, skip: MAX_RUNS, select: { id: true } });
  if (old.length) await prisma.run.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export async function clearRuns(): Promise<void> {
  await prisma.run.deleteMany();
}

export async function audit(actor: string, action: string, target: string): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target } });
}
