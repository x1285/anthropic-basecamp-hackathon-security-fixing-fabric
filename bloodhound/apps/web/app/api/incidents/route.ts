// Webhook: receives OSV-style payloads. Returns the run id; the run continues inside the request.
import { NextResponse } from 'next/server';
import { ingestIncident } from '@bloodhound/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  try {
    const { runId } = await ingestIncident(payload as Parameters<typeof ingestIncident>[0]);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
