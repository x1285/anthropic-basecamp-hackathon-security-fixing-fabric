import Link from 'next/link';
import { prisma, CONFIG } from '@bloodhound/engine';
import { slaStatus } from '@bloodhound/core';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const [projects, envs, customers, repos, runs] = await Promise.all([
    prisma.project.count(),
    prisma.environment.count(),
    prisma.customer.count(),
    prisma.repo.count(),
    prisma.run.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { incident: true, repoStates: true, groups: true },
    }),
  ]);
  const now = new Date();

  return (
    <>
      <h1>Dashboard</h1>
      <section className="cards" data-testid="overview">
        <div className="card"><div className="muted">Projekte</div><strong data-testid="count-projects">{projects}</strong></div>
        <div className="card"><div className="muted">Environments</div><strong data-testid="count-envs">{envs}</strong></div>
        <div className="card"><div className="muted">Kunden</div><strong data-testid="count-customers">{customers}</strong></div>
        <div className="card"><div className="muted">Repos</div><strong data-testid="count-repos">{repos}</strong></div>
      </section>

      <section>
        <h2>Incident-Runs</h2>
        {runs.length === 0 ? (
          <p className="muted">Noch keine Runs. Im <Link href="/lab">Demo-Lab</Link> einen Incident auslösen.</p>
        ) : (
          <table data-testid="runs">
            <thead>
              <tr><th>Incident</th><th>Severity</th><th>Status</th><th>Repos (betroffen / gefixt)</th><th>Gruppen</th><th>Frist (engste)</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const sla = r.slaByEnv as Record<string, { hours: number }>;
                const tightest = Object.values(sla).reduce((m, s) => Math.min(m, s.hours), Infinity);
                const deadline = Number.isFinite(tightest)
                  ? slaStatus(r.incident.detectedAt, tightest, now, CONFIG.slaAlarmAt, false)
                  : null;
                const fixed = r.repoStates.filter((s) => s.status === 'fixed').length;
                return (
                  <tr key={r.id} data-testid="run-row" data-status={r.status}>
                    <td><Link href={`/runs/${r.id}`}>{r.incident.id}</Link><div className="muted">{r.incident.packageName}</div></td>
                    <td>{r.incident.severity}</td>
                    <td data-testid="run-status">{r.status}</td>
                    <td>{r.repoStates.length} / {fixed}</td>
                    <td>{r.groups.length}</td>
                    <td>
                      {deadline ? (
                        <span className={deadline.breached ? 'bad' : deadline.alarm ? 'warn' : ''}>
                          {deadline.breached ? 'überschritten' : `noch ${Math.max(0, deadline.remainingHours).toFixed(1)} h`}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
