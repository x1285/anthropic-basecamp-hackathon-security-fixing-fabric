'use server';

// The only write path from the UI. Every call goes through the engine, which applies the core rules and saves to Postgres.
import { mutate as engineMutate, type AppOp, type MutateResult } from '@bloodhound/engine';

export async function mutate(op: AppOp): Promise<MutateResult> {
  return engineMutate(op, 'ui');
}
