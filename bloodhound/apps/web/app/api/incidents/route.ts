import { NextResponse } from 'next/server';
import { fireFromPayload } from '@bloodhound/engine';

// Webhook: an OSV-style payload starts a run. The lab shows exactly this payload.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  try {
    const res = await fireFromPayload(body);
    return NextResponse.json({ runId: res.runId, status: 'run started' }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
