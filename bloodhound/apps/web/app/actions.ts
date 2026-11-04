'use server';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ingestIncident, approveMessage, mergeAndDeploy, MOCKDATA } from '@bloodhound/engine';

export async function fireMockIncident(formData: FormData): Promise<void> {
  const file = String(formData.get('file') ?? '');
  if (!/^[\w.-]+\.json$/.test(file)) throw new Error('invalid incident file');
  const payload = JSON.parse(readFileSync(join(MOCKDATA, 'incidents', file), 'utf8'));
  const { runId } = await ingestIncident(payload);
  redirect(`/runs/${runId}`);
}

export async function fireCustomIncident(formData: FormData): Promise<void> {
  const payload = JSON.parse(String(formData.get('payload') ?? '{}'));
  const { runId } = await ingestIncident(payload);
  redirect(`/runs/${runId}`);
}

export async function approve(formData: FormData): Promise<void> {
  const id = String(formData.get('messageId'));
  await approveMessage(id, 'ui-approver');
  revalidatePath('/inbox');
  revalidatePath('/outbox');
  revalidatePath('/');
}

export async function mergeDeploy(formData: FormData): Promise<void> {
  const id = String(formData.get('prId'));
  const runId = String(formData.get('runId'));
  await mergeAndDeploy(id, 'ui-operator');
  revalidatePath(`/runs/${runId}`);
  revalidatePath('/');
}
