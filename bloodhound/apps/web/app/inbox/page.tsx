import { prisma, CONFIG } from '@bloodhound/engine';
import { approvalPingDue } from '@bloodhound/core';
import { approve } from '../actions';

export const dynamic = 'force-dynamic';

export default async function Inbox() {
  const pending = await prisma.message.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    include: { run: { include: { incident: true } } },
  });
  const now = new Date();

  return (
    <>
      <h1>Freigaben</h1>
      <p className="muted">Kundentexte werden erst nach Freigabe in die Outbox verteilt.</p>
      {pending.length === 0 && <p data-testid="inbox-empty">Keine offenen Freigaben.</p>}
      {pending.map((m) => {
        const slaByEnv = m.run.slaByEnv as Record<string, { hours: number }>;
        const sla = Object.values(slaByEnv).reduce((min, s) => Math.min(min, s.hours), Infinity);
        const ping = Number.isFinite(sla) && approvalPingDue(m.run.incident.detectedAt, sla, now, CONFIG.approvalEscalateAt);
        return (
          <div className="card" key={m.id} data-testid="approval" data-kind={m.kind} style={{ marginBottom: 12 }}>
            <strong>{m.kind === 'incident_notice' ? 'Kundentext zu' : 'Auflösung zu'} {m.run.incident.id}</strong>
            <div className="muted">
              wartet seit {m.createdAt.toISOString()}{ping ? ' · Backup-Approver angezeigt (Timer überschritten)' : ''}
            </div>
            <pre>{m.body}</pre>
            <form action={approve}>
              <input type="hidden" name="messageId" value={m.id} />
              <button type="submit" className="primary" data-testid="approve">Freigeben</button>
            </form>
          </div>
        );
      })}
    </>
  );
}
