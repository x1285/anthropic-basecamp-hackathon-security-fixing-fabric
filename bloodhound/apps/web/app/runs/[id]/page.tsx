import { notFound } from 'next/navigation';
import { prisma, CONFIG } from '@bloodhound/engine';
import { slaStatus, type Finding } from '@bloodhound/core';
import { mergeDeploy } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await prisma.run.findUnique({
    where: { id },
    include: {
      incident: true,
      groups: { include: { recipe: { include: { versions: { orderBy: { createdAt: "asc" } } } } } },
      repoStates: true,
      pullRequests: true,
      escalations: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!run) notFound();

  const scan = run.scan as unknown as Finding[];
  const envs = await prisma.environment.findMany({ where: { id: { in: Object.keys(run.slaByEnv as object) } } });
  const envName = new Map(envs.map((e) => [e.id, e.id]));
  const now = new Date();
  const sla = run.slaByEnv as Record<string, { hours: number; source: string; strictestCustomerId?: string }>;

  return (
    <>
      <h1>Run {run.incident.id}</h1>
      <p className="muted">
        {run.incident.packageName} · {run.incident.severity} · Status <strong data-testid="run-status">{run.status}</strong> · erkannt {run.incident.detectedAt.toISOString()}
      </p>

      <section>
        <h2>SLA je Environment</h2>
        <table data-testid="sla">
          <thead><tr><th>Environment</th><th>SLA</th><th>Quelle</th><th>Frist</th></tr></thead>
          <tbody>
            {Object.entries(sla).map(([envId, s]) => {
              const st = slaStatus(run.incident.detectedAt, s.hours, now, CONFIG.slaAlarmAt, run.pullRequests.length > 0);
              return (
                <tr key={envId} data-testid="sla-row">
                  <td>{envName.get(envId)}</td>
                  <td>{s.hours} h</td>
                  <td>{s.source === 'customers' ? 'strengster Kunde' : 'Environment-Floor (keine Kunden)'}</td>
                  <td className={st.breached ? 'bad' : st.alarm ? 'warn' : ''}>
                    {st.breached ? 'überschritten' : `noch ${Math.max(0, st.remainingHours).toFixed(1)} h`}{st.alarm ? ' · Alarm' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Betroffene Repos</h2>
        <table data-testid="scan">
          <thead><tr><th>Repo</th><th>Scope</th><th>Version</th><th>Status</th><th>Hinweis</th></tr></thead>
          <tbody>
            {scan.filter((f) => f.affected || f.unpinned).map((f, i) => (
              <tr key={i} data-testid="scan-row">
                <td>{f.repoId}</td>
                <td>{f.scope === 'main' ? 'main' : envName.get(f.scope) ?? f.scope}</td>
                <td>{f.version}</td>
                <td className={f.affected ? 'bad' : ''}>{f.affected ? 'betroffen' : 'ok'}</td>
                <td>{f.unpinned ? 'ungepinnt, manuell prüfen' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p data-testid="headline">
          {new Set(scan.filter((f) => f.affected).map((f) => f.repoId)).size} betroffene Repos,{' '}
          {run.groups.length} verschiedene Fixes
        </p>
      </section>

      <section>
        <h2>Gruppen und Rezepte</h2>
        {run.groups.map((g) => (
          <div className="card" key={g.id} data-testid="group" data-status={g.status} style={{ marginBottom: 12 }}>
            <strong>{g.signature}</strong> · {g.strategy} · Status {g.status} · Confidence {g.confidence}
            <p>{g.rationale}</p>
            <div className="muted">Repos: {(g.repoIds as string[]).join(', ')}</div>
            {g.recipe && (
              <details>
                <summary>Rezept v{g.recipe.version} ({g.recipe.complexity})</summary>
                <pre>{JSON.stringify(g.recipe.steps, null, 2)}</pre>
                <h4>Learnings</h4>
                <ul data-testid="learnings">
                  {g.recipe.versions.map((v) => <li key={v.id}>v{v.version}: {v.learning}</li>)}
                </ul>
              </details>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>Repo-Status</h2>
        <table data-testid="repo-states">
          <thead><tr><th>Repo</th><th>Status</th></tr></thead>
          <tbody>
            {run.repoStates.map((s) => (
              <tr key={s.id} data-testid="repo-state" data-status={s.status}>
                <td>{s.repoId}</td>
                <td className={s.status === 'fixed' ? 'ok' : s.status === 'escalated' ? 'bad' : ''}>{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Simulierte PRs</h2>
        {run.pullRequests.length === 0 && <p className="muted">Keine PRs.</p>}
        {run.pullRequests.map((pr) => (
          <div className="card" key={pr.id} data-testid="pr" data-status={pr.status} style={{ marginBottom: 12 }}>
            <strong>{pr.title}</strong> · {pr.status}
            <ul>
              {(pr.checks as unknown as Array<{ name: string; ok: boolean; detail: string }>).map((c, i) => (
                <li key={i} className={c.ok ? 'ok' : 'bad'}>{c.ok ? '✓' : '✗'} {c.name}: {c.detail}</li>
              ))}
            </ul>
            <details>
              <summary>Diff</summary>
              <pre>{pr.diff}</pre>
            </details>
            {pr.status === 'open' && (
              <form action={mergeDeploy}>
                <input type="hidden" name="prId" value={pr.id} />
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className="primary" data-testid="merge-deploy">Merge &amp; Deploy</button>
              </form>
            )}
          </div>
        ))}
      </section>

      <section>
        <h2>Eskalationen</h2>
        {run.escalations.length === 0 && <p className="muted">Keine.</p>}
        {run.escalations.map((e) => {
          const ticket = e.ticket as unknown as { title: string; assigneeTeam: string; checklist: string[] };
          return (
            <div className="card" key={e.id} data-testid="escalation" style={{ marginBottom: 12 }}>
              <strong>{e.repoId}</strong> · {e.reason}
              <div className="muted">Ticket für {ticket.assigneeTeam}: {ticket.title}</div>
              <ol>{ticket.checklist.map((c, i) => <li key={i}>{c}</li>)}</ol>
            </div>
          );
        })}
      </section>

      <section>
        <h2>Nachrichten</h2>
        <ul data-testid="messages">
          {run.messages.map((m) => (
            <li key={m.id} data-kind={m.kind} data-status={m.status}>{m.kind} · {m.status}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
