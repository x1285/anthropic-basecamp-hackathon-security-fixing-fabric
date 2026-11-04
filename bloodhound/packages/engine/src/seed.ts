// Loads mockdata/ into the database. Clears all Bloodhound state first (it is a mock world, nothing is lost).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from './db';
import { MOCKDATA, ROOT } from './paths';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export async function seed(): Promise<{ projects: number; envs: number; customers: number; repos: number; incidents: number }> {
  await prisma.pullRequest.deleteMany();
  await prisma.fixAttempt.deleteMany();
  await prisma.escalation.deleteMany();
  await prisma.message.deleteMany();
  await prisma.repoState.deleteMany();
  await prisma.recipeVersion.deleteMany();
  await prisma.group.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.run.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.customerEnvironment.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.environment.deleteMany();
  await prisma.repo.deleteMany();
  await prisma.project.deleteMany();
  await prisma.auditLog.deleteMany();

  const data = readJson<{
    projects: Array<{ id: string; name: string; ownerTeam: string }>;
    environments: Array<{ id: string; projectId: string; name: string; pipelinePos: number; rules: object }>;
    repos: Array<{ id: string; projectId: string; framework: string; dirPath: string; direct: string[]; envIds: string[] }>;
  }>(join(MOCKDATA, 'projects.json'));
  const releases = readJson<Record<string, { release: string; deployedAt: string; versions: object }>>(join(MOCKDATA, 'releases.json'));
  const customers = readJson<Array<{ id: string; name: string; tier: string; slaHours: object; contacts: object; optInNotAffected: boolean; environments: string[] }>>(
    join(MOCKDATA, 'customers.json'),
  );

  await prisma.project.createMany({ data: data.projects });
  for (const r of data.repos) {
    const dir = join(ROOT, r.dirPath);
    const pkg = readJson<{ dependencies?: Record<string, string> }>(join(dir, 'package.json'));
    const lock = readJson<{ packages: Record<string, { version: string }> }>(join(dir, 'package-lock.json'));
    const mainLock: Record<string, string> = {};
    for (const [k, v] of Object.entries(lock.packages)) if (k.startsWith('node_modules/')) mainLock[k.slice(13)] = v.version;
    await prisma.repo.create({
      data: {
        id: r.id,
        projectId: r.projectId,
        name: r.id,
        framework: r.framework,
        dirPath: r.dirPath,
        direct: r.direct,
        declared: pkg.dependencies ?? {},
        lock: mainLock,
        envIds: r.envIds,
      },
    });
  }
  for (const e of data.environments) {
    const rel = releases[e.id];
    await prisma.environment.create({
      data: {
        id: e.id,
        projectId: e.projectId,
        name: e.name,
        pipelinePos: e.pipelinePos,
        release: rel?.release ?? `${e.id}-none`,
        deployedAt: new Date(rel?.deployedAt ?? '2026-10-28T09:00:00Z'),
        versions: (rel?.versions ?? {}) as object,
        rules: e.rules,
      },
    });
  }
  for (const c of customers) {
    await prisma.customer.create({
      data: { id: c.id, name: c.name, tier: c.tier, slaHours: c.slaHours, contacts: c.contacts, optInNotAffected: c.optInNotAffected },
    });
    for (const envId of c.environments) {
      await prisma.customerEnvironment.create({ data: { customerId: c.id, environmentId: envId } });
    }
  }
  // Config defaults (concept section 5). Booleans only: numeric config lives in pipeline.CONFIG.
  for (const [name, enabled] of Object.entries({
    'recipe.allowCodeChanges': false,
    'feature.atRiskFlagging': false,
  })) {
    await prisma.flag.upsert({ where: { name }, update: { enabled }, create: { name, enabled } });
  }

  const incidents = readdirSync(join(MOCKDATA, 'incidents')).length;
  return {
    projects: data.projects.length,
    envs: data.environments.length,
    customers: customers.length,
    repos: data.repos.length,
    incidents,
  };
}
