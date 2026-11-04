// What the UI can do. Each call loads the state, applies one change from packages/core, and saves it.
import { randomUUID } from 'node:crypto';
import {
  applyWorldOp, approveNotice, approveResolution, buildRun, incidentFromPayload, priority, eligible, runNext, runOne,
  seedWorld, verify, type Incident, type Run, type World, type WorldOp,
} from '@bloodhound/core';
import { audit, clearRuns, findRun, loadRuns, loadWorld, saveRun, saveWorld } from './store';

export interface AppState {
  world: World;
  runs: Run[];
}

export type RunOp =
  | { type: 'fire'; incident: Incident }
  | { type: 'set-tpl'; runId: string; part: 'notify' | 'resolution'; field: 'subject' | 'body'; value: string }
  | { type: 'approve-notify'; runId: string; subject: string; body: string }
  | { type: 'run-next'; runId: string }
  | { type: 'run-all'; runId: string }
  | { type: 'verify'; runId: string; repoId: string }
  | { type: 'approve-resolution'; runId: string; subject: string; body: string }
  | { type: 'reset' };

export type AppOp = WorldOp | RunOp;

export interface MutateResult {
  state: AppState;
  error?: string;
  runId?: string;
}

export async function loadState(): Promise<AppState> {
  const [world, runs] = await Promise.all([loadWorld(), loadRuns()]);
  return { world, runs };
}

const ctx = () => ({ newId: () => randomUUID(), rng: Math.random });

async function fail(error: string): Promise<MutateResult> {
  return { state: await loadState(), error };
}

/** Fires an incident and stores the run. Used by the lab and by the webhook. */
export async function fireIncident(incident: Incident, actor = 'lab'): Promise<MutateResult> {
  const world = await loadWorld();
  const run = buildRun(world, incident, Date.now(), Math.random, randomUUID());
  await saveRun(run);
  await audit(actor, 'fire', incident.id);
  return { state: await loadState(), runId: run.id };
}

/** Webhook entry point: OSV-style payload in, run out. Bad payloads throw a readable error. */
export async function fireFromPayload(payload: unknown): Promise<MutateResult> {
  return fireIncident(incidentFromPayload(payload), 'webhook');
}

async function applyRunOp(op: RunOp, actor: string): Promise<MutateResult> {
  if (op.type === 'fire') return fireIncident(op.incident, actor);
  if (op.type === 'reset') {
    await saveWorld(seedWorld());
    await clearRuns();
    await audit(actor, 'reset', 'world');
    return { state: await loadState() };
  }
  const run = await findRun(op.runId);
  if (!run) return fail('Unknown run');
  const now = Date.now();
  switch (op.type) {
    case 'set-tpl':
      if (op.part === 'notify') run.notify[op.field] = op.value;
      else run.resolution[op.field] = op.value;
      break;
    case 'approve-notify': {
      if (run.notify.status !== 'pending') return fail('The advisory is already approved.');
      approveNotice(run, op.subject, op.body, now);
      await audit(actor, 'approve-notify', run.id);
      break;
    }
    case 'run-next': {
      if (!priority(run).some(eligible)) return fail('Nothing left to run.');
      runNext(run);
      break;
    }
    case 'run-all': {
      let n = 0;
      while (n++ < 100 && runNext(run));
      break;
    }
    case 'verify': {
      const st = run.repoState[op.repoId];
      if (!st || !['pr', 'deploy-ready'].includes(st.status)) return fail('Only an open PR or a deploy request can be verified.');
      verify(run, op.repoId);
      await audit(actor, 'verify', `${run.id}:${op.repoId}`);
      break;
    }
    case 'approve-resolution': {
      if (run.notify.status === 'pending') return fail('Send the advisory first.');
      const sent = approveResolution(run, op.subject, op.body);
      if (!sent) return fail('No customer has every affected project verified yet.');
      await audit(actor, 'approve-resolution', run.id);
      break;
    }
  }
  await saveRun(run);
  return { state: await loadState() };
}

/** Single entry point for every UI change. Invalid input comes back as `error`, never as an exception. */
const RUN_OPS = new Set<RunOp['type']>(['fire', 'set-tpl', 'approve-notify', 'run-next', 'run-all', 'verify', 'approve-resolution', 'reset']);

export async function mutate(op: AppOp, actor = 'ui'): Promise<MutateResult> {
  if (RUN_OPS.has(op.type as RunOp['type'])) return applyRunOp(op as RunOp, actor);
  const world = await loadWorld();
  const res = applyWorldOp(world, op as WorldOp, ctx());
  if (res.error) return fail(res.error);
  await saveWorld(res.world);
  await audit(actor, op.type, 'world');
  return { state: await loadState() };
}
