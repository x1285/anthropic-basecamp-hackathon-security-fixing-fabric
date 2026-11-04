// Edits to the demo world (projects, repos, customers, environments). Pure: each call returns a new world.
import { fakeRepo, NAME_A, NAME_B, ECO_NAMES, parseManifest } from './repo-input';
import { TIERS } from './seed';
import type { Eco, Environment, Repo, Sev, Tests, Tier, World } from './model';

export type WorldOp =
  | { type: 'watch'; repoId: string; watched: boolean }
  | { type: 'deploy'; repoId: string; envId: string; deployed: boolean }
  | { type: 'release'; repoId: string; envId: string; release: string }
  | { type: 'cell'; repoId: string; depIndex: number; envId: string; value: string }
  | { type: 'tests'; repoId: string; tests: Tests }
  | { type: 'regen'; repoId: string }
  | { type: 'remove-repo'; repoId: string }
  | { type: 'add-repo-fake'; projectId: string; ecosystem: Eco; name: string }
  | { type: 'add-repo-manifest'; projectId: string; name: string; text: string }
  | { type: 'project-field'; projectId: string; field: 'name' | 'owner'; value: string }
  | { type: 'add-project'; name: string; owner: string }
  | { type: 'remove-project'; projectId: string }
  | { type: 'env-customer'; projectId: string; envId: string; customerId: string; add: boolean }
  | { type: 'customer-field'; customerId: string; field: 'name' | 'contact' | 'notifyUnaffected'; value: string | boolean }
  | { type: 'customer-tier'; customerId: string; tier: Tier }
  | { type: 'customer-sla'; customerId: string; sev: Sev; hours: number | null }
  | { type: 'add-customer' }
  | { type: 'remove-customer'; customerId: string }
  | { type: 'env-field'; envId: string; field: 'name' | 'ticket' | 'slack' | 'channel' | 'page'; value: string | boolean }
  | { type: 'env-sla'; envId: string; sev: Sev; hours: number | null }
  | { type: 'env-move'; envId: string; delta: -1 | 1 }
  | { type: 'env-add' }
  | { type: 'env-remove'; envId: string };

export interface WorldCtx {
  newId: () => string;
  rng: () => number;
}

export interface WorldResult {
  world: World;
  error?: string;
}

const positive = (h: number | null): number | null => (h !== null && h > 0 ? h : null);

function findRepo(w: World, id: string): { repo: Repo; projectIdx: number; repoIdx: number } | null {
  for (let pi = 0; pi < w.projects.length; pi++) {
    const ri = w.projects[pi]!.repos.findIndex((r) => r.id === id);
    if (ri >= 0) return { repo: w.projects[pi]!.repos[ri]!, projectIdx: pi, repoIdx: ri };
  }
  return null;
}

/** Applies one world edit. Unknown ids and invalid input come back as an error message, never a throw. */
export function applyWorldOp(input: World, op: WorldOp, ctx: WorldCtx): WorldResult {
  const w: World = structuredClone(input);
  const fail = (error: string): WorldResult => ({ world: input, error });
  const proj = (id: string) => w.projects.find((p) => p.id === id);
  const cust = (id: string) => w.customers.find((c) => c.id === id);
  const env = (id: string) => w.envs.find((e) => e.id === id);

  switch (op.type) {
    case 'watch': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      f.repo.watched = op.watched; break;
    }
    case 'deploy': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      f.repo.deployed[op.envId] = op.deployed; break;
    }
    case 'release': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      f.repo.releases[op.envId] = op.release.trim(); break;
    }
    case 'cell': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      const d = f.repo.deps[op.depIndex]; if (!d) return fail('Unknown dependency');
      const v = op.value.trim();
      if (op.envId === 'main') { if (v) d.version = v; }
      else if (!v || v === d.version) delete d.env[op.envId];
      else d.env[op.envId] = v;
      break;
    }
    case 'tests': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      f.repo.tests = op.tests; break;
    }
    case 'regen': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      const fresh = fakeRepo(f.repo.id, f.repo.name, f.repo.ecosystem, w.envs, ctx.rng);
      f.repo.deps = fresh.deps; f.repo.releases = fresh.releases; break;
    }
    case 'remove-repo': {
      const f = findRepo(w, op.repoId); if (!f) return fail('Unknown repo');
      w.projects[f.projectIdx]!.repos.splice(f.repoIdx, 1); break;
    }
    case 'add-repo-fake': {
      const p = proj(op.projectId); if (!p) return fail('Unknown project');
      if (!ECO_NAMES.includes(op.ecosystem)) return fail('Unknown ecosystem');
      let name = op.name.trim() || `${NAME_A[Math.floor(ctx.rng() * NAME_A.length)]}-${NAME_B[Math.floor(ctx.rng() * NAME_B.length)]}`;
      while (w.projects.some((x) => x.repos.some((r) => r.name === name))) name += '-2';
      p.repos.push(fakeRepo(ctx.newId(), name, op.ecosystem, w.envs, ctx.rng));
      break;
    }
    case 'add-repo-manifest': {
      const p = proj(op.projectId); if (!p) return fail('Unknown project');
      let parsed;
      try { parsed = parseManifest(op.text); } catch (e) { return fail((e as Error).message); }
      const name = op.name.trim() || parsed.guessName || 'pasted-repo';
      const deployed: Record<string, boolean> = {};
      for (const e of w.envs) deployed[e.id] = true;
      p.repos.push({ id: ctx.newId(), name, ecosystem: parsed.ecosystem, watched: true, source: 'manifest', tests: 'some', deployed, releases: {}, deps: parsed.deps });
      break;
    }
    case 'project-field': {
      const p = proj(op.projectId); if (!p) return fail('Unknown project');
      p[op.field] = op.value.trim() || p[op.field]; break;
    }
    case 'add-project': {
      w.projects.push({ id: ctx.newId(), name: op.name.trim() || 'New project', owner: op.owner.trim() || 'Unassigned', repos: [], envs: {} });
      break;
    }
    case 'remove-project': {
      if (!proj(op.projectId)) return fail('Unknown project');
      w.projects = w.projects.filter((p) => p.id !== op.projectId); break;
    }
    case 'env-customer': {
      const p = proj(op.projectId); if (!p) return fail('Unknown project');
      if (!env(op.envId) || !cust(op.customerId)) return fail('Unknown environment or customer');
      const slot = (p.envs[op.envId] ??= { customers: [] });
      if (op.add) { if (!slot.customers.includes(op.customerId)) slot.customers.push(op.customerId); }
      else slot.customers = slot.customers.filter((c) => c !== op.customerId);
      break;
    }
    case 'customer-field': {
      const c = cust(op.customerId); if (!c) return fail('Unknown customer');
      if (op.field === 'notifyUnaffected') c.notifyUnaffected = Boolean(op.value);
      else if (op.field === 'name') c.name = String(op.value).trim() || c.name;
      else c.contact = String(op.value).trim();
      break;
    }
    case 'customer-tier': {
      const c = cust(op.customerId); if (!c) return fail('Unknown customer');
      c.tier = op.tier; c.sla = { ...TIERS[op.tier] }; break;
    }
    case 'customer-sla': {
      const c = cust(op.customerId); if (!c) return fail('Unknown customer');
      c.sla[op.sev] = positive(op.hours); break;
    }
    case 'add-customer': {
      w.customers.push({ id: ctx.newId(), name: 'New customer', tier: 'Standard', sla: { ...TIERS.Standard }, contact: '', notifyUnaffected: false });
      break;
    }
    case 'remove-customer': {
      if (!cust(op.customerId)) return fail('Unknown customer');
      w.customers = w.customers.filter((c) => c.id !== op.customerId);
      for (const p of w.projects) for (const slot of Object.values(p.envs)) slot.customers = slot.customers.filter((c) => c !== op.customerId);
      break;
    }
    case 'env-field': {
      const e = env(op.envId); if (!e) return fail('Unknown environment');
      if (op.field === 'ticket' || op.field === 'slack') e[op.field] = Boolean(op.value);
      else if (op.field === 'name') e.name = String(op.value).trim() || e.name;
      else if (op.field === 'page') e.page = op.value as Environment['page'];
      else e.channel = String(op.value);
      break;
    }
    case 'env-sla': {
      const e = env(op.envId); if (!e) return fail('Unknown environment');
      e.sla[op.sev] = positive(op.hours); break;
    }
    case 'env-move': {
      const i = w.envs.findIndex((e) => e.id === op.envId), j = i + op.delta;
      if (i < 0) return fail('Unknown environment');
      if (j < 0 || j >= w.envs.length) break;
      [w.envs[i], w.envs[j]] = [w.envs[j]!, w.envs[i]!];
      break;
    }
    case 'env-add': {
      const e: Environment = {
        id: ctx.newId(), name: 'env-' + (w.envs.length + 1),
        sla: { critical: 24, high: 72, medium: null, low: null }, ticket: true, slack: false, channel: '#alerts', page: 'never',
      };
      w.envs.push(e);
      for (const p of w.projects) {
        p.envs[e.id] = { customers: [] };
        for (const r of p.repos) r.deployed[e.id] = false;
      }
      break;
    }
    case 'env-remove': {
      if (!env(op.envId)) return fail('Unknown environment');
      if (w.envs.length === 1) return fail('At least one environment must remain');
      w.envs = w.envs.filter((e) => e.id !== op.envId);
      for (const p of w.projects) {
        delete p.envs[op.envId];
        for (const r of p.repos) {
          delete r.deployed[op.envId];
          delete r.releases[op.envId];
          for (const d of r.deps) delete d.env[op.envId];
        }
      }
      break;
    }
    default: {
      const never: never = op;
      return fail(`Unknown operation ${JSON.stringify(never)}`);
    }
  }
  return { world: w };
}
