import { prisma } from '@bloodhound/engine';

export const dynamic = 'force-dynamic';

export default async function Outbox() {
  const copies = await prisma.message.findMany({
    where: { kind: { in: ['outbox_copy'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { run: { include: { incident: true } } },
  });
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const names = new Map(customers.map((c) => [c.id, c.name]));

  return (
    <>
      <h1>Outbox</h1>
      <p className="muted">Simulierte Mails. Es wird nichts versendet.</p>
      <p data-testid="outbox-count">{copies.length} Nachricht(en)</p>
      <table>
        <thead><tr><th>Kunde</th><th>Incident</th><th>Status</th><th>Text</th></tr></thead>
        <tbody>
          {copies.map((m) => (
            <tr key={m.id} data-testid="outbox-row">
              <td>{m.customerId ? names.get(m.customerId) ?? m.customerId : '—'}</td>
              <td>{m.run.incident.id}</td>
              <td>{m.status}</td>
              <td><pre>{m.body}</pre></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
