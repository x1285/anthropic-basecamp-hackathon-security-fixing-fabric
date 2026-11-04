'use client';

// React port of the target UI (Bloodhound.html). Markup, copy and behaviour follow the prototype.
// All rules come from @bloodhound/core; every change goes through the server action `mutate`.
import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  DEMO_DRAFT, ECOS, PRESETS, PRESET_LABELS, SEVS, TESTS_LABEL, TIERS, custCount, dueText, effSla, eligible, envCustomers, fill, fmtDue,
  fmtHours, listText, payload, priority, prText, rangeText, recipientVars, resolvable, runSummary, stepStates, ticketText,
  uniq, verIn, waitText, type Incident, type PlannedRow, type Project, type Repo, type RepoResult, type Run, type Sev, type Tests,
  type Tier, type World,
} from '@bloodhound/core';
import type { AppOp, AppState, MutateResult } from '@bloodhound/engine';
import { mutate } from './actions';

type View = 'projects' | 'customers' | 'environments' | 'lab' | 'runs';
type Sel = { kind: 'project'; id: string | null } | { kind: 'repo'; id: string } | { kind: 'add-project' } | { kind: 'add-repo'; id: string };
type Act = (op: AppOp) => Promise<MutateResult>;

const VIEWS: View[] = ['projects', 'customers', 'environments', 'lab', 'runs'];
const LABEL: Record<View, string> = { projects: 'Projects', customers: 'Customers', environments: 'Environments', lab: 'Incident lab', runs: 'Runs' };
const VERDICT_LABEL: Record<string, string> = { affected: 'Affected', unknown: 'Check manually', patched: 'Not affected', clear: 'Clear', none: 'Not deployed' };
const PILL: Record<string, [string, string]> = {
  queued: ['Queued', ''], pr: ['PR open', 'info'], 'deploy-ready': ['Deploy ready', 'info'], verified: ['Verified', 'ok'], escalated: ['Escalated', 'bad'],
};
const FINAL = ['verified', 'escalated'];

function readView(): View {
  const h = window.location.hash.slice(1) as View;
  return VIEWS.includes(h) ? h : 'projects';
}

/** Text input that saves on blur or Enter, like the prototype's change event. */
function Field({ value, onSave, ...rest }: { value: string; onSave: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onSave(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Switch({ checked, onChange, label, ...rest }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange'>) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />
      {label}
    </label>
  );
}

const Pill = ({ text, cls }: { text: string; cls?: string }) => <span className={`pill ${cls ?? ''}`}>{text}</span>;
const Sev = ({ s }: { s: string }) => <span className={`sev ${s}`}>{s}</span>;

export function BloodhoundApp({ initial }: { initial: AppState }) {
  const [data, setData] = useState<AppState>(initial);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>('projects');
  const [sel, setSel] = useState<Sel>({ kind: 'project', id: initial.world.projects[0]?.id ?? null });
  const [addMode, setAddMode] = useState<'fake' | 'manifest'>('fake');
  const [addErr, setAddErr] = useState('');
  const [runSel, setRunSel] = useState<string | null>(initial.runs[0]?.id ?? null);
  const [openPr, setOpenPr] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Incident>({ ...DEMO_DRAFT });
  const [now, setNow] = useState(0);
  const [toast, setToast] = useState('');
  const [armed, setArmed] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setMounted(true);
    setView(readView());
    setNow(Date.now());
    const onHash = () => setView(readView());
    window.addEventListener('hashchange', onHash);
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(tick); };
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  };

  /** One change: the server applies it and returns the new state. Errors are shown, never thrown. */
  async function act(op: AppOp, quiet = false): Promise<MutateResult> {
    const res = await mutate(op);
    if (res.error) { if (!quiet) flash(res.error); return res; }
    setData(res.state);
    return res;
  }

  const { world, runs } = data;
  const allRepos = world.projects.flatMap((p) => p.repos.map((r) => ({ r, p })));
  const findRepo = (id: string) => {
    for (const p of world.projects) { const r = p.repos.find((x) => x.id === id); if (r) return { r, p }; }
    return null;
  };
  const run = runs.find((r) => r.id === runSel) ?? runs[0] ?? null;

  if (!mounted) {
    return (
      <>
        <Header world={world} runs={runs} view={view} />
        <main className="wrap" />
      </>
    );
  }

  return (
    <>
      <Header world={world} runs={runs} view={view} />
      <main className="wrap">
        {view === 'projects' && (
          <section className="view on">
            <div className="intro">
              <h1>Projects</h1>
              A project has repos and environments, and each environment serves one or more customers. Switch on <em>Watch</em> for the repos Bloodhound should check when an incident comes in.
            </div>
            <div className="cols">
              <div>
                <button className="btn primary" style={{ width: '100%' }} onClick={() => setSel({ kind: 'add-project' })}>Add a project</button>
                <ul className="proj" style={{ marginTop: 12 }}>
                  {world.projects.length === 0 && <li className="empty small">No projects yet.</li>}
                  {world.projects.map((p) => (
                    <li key={p.id} style={{ marginBottom: 10 }}>
                      <button className="proj-item" aria-current={sel.kind === 'project' && sel.id === p.id ? 'true' : 'false'}
                        onClick={() => setSel({ kind: 'project', id: p.id })}>
                        <span className="nm">{p.name}</span>
                        <span className="meta">{p.owner}, {p.repos.length} repo{p.repos.length === 1 ? '' : 's'}</span>
                      </button>
                      <ul className="sub">
                        {p.repos.map((r) => (
                          <li key={r.id}>
                            <div className="repo-item" role="button" tabIndex={0} aria-current={sel.kind === 'repo' && sel.id === r.id ? 'true' : 'false'}
                              onClick={() => setSel({ kind: 'repo', id: r.id })}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel({ kind: 'repo', id: r.id }); } }}>
                              <div className="grow">
                                <span className="nm">{r.name}</span>
                                <span className="meta"><span className="eco">{r.ecosystem}</span> {TESTS_LABEL[r.tests]} tests</span>
                              </div>
                              <label className="switch" onClick={(e) => e.stopPropagation()}>
                                <input type="checkbox" checked={r.watched} aria-label={`Watch ${r.name}`}
                                  onChange={(e) => act({ type: 'watch', repoId: r.id, watched: e.target.checked })} />
                                Watch
                              </label>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="panel">
                {sel.kind === 'add-project' && (
                  <AddProject onCreate={async (name, owner) => {
                    const res = await act({ type: 'add-project', name, owner });
                    if (!res.error) setSel({ kind: 'project', id: res.state.world.projects.at(-1)?.id ?? null });
                  }} />
                )}
                {sel.kind === 'add-repo' && (() => {
                  const p = world.projects.find((x) => x.id === sel.id);
                  if (!p) return null;
                  return (
                    <AddRepo key={p.id} project={p} mode={addMode} setMode={setAddMode} err={addErr}
                      onBack={() => setSel({ kind: 'project', id: p.id })}
                      onFake={async (ecosystem, name) => {
                        const res = await act({ type: 'add-repo-fake', projectId: p.id, ecosystem, name });
                        if (!res.error) setSel({ kind: 'repo', id: res.state.world.projects.find((x) => x.id === p.id)!.repos.at(-1)!.id });
                      }}
                      onManifest={async (name, text) => {
                        setAddErr('');
                        const res = await act({ type: 'add-repo-manifest', projectId: p.id, name, text }, true);
                        if (res.error) { setAddErr(res.error); return; }
                        setSel({ kind: 'repo', id: res.state.world.projects.find((x) => x.id === p.id)!.repos.at(-1)!.id });
                        flash(`Added ${name} with dependencies from the manifest`);
                      }} />
                  );
                })()}
                {sel.kind === 'repo' && findRepo(sel.id) && (() => {
                  const f = findRepo(sel.id)!;
                  return <RepoDetail key={f.r.id} repo={f.r} project={f.p} envs={world.envs}
                    onBack={() => setSel({ kind: 'project', id: f.p.id })}
                    act={act}
                    onRemoved={() => setSel({ kind: 'project', id: f.p.id })} />;
                })()}
                {(sel.kind === 'project' || (sel.kind === 'repo' && !findRepo(sel.id))) && (() => {
                  const p = world.projects.find((x) => x.id === (sel.kind === 'project' ? sel.id : null)) ?? world.projects[0];
                  if (!p) return <AddProject onCreate={async (name, owner) => {
                    const res = await act({ type: 'add-project', name, owner });
                    if (!res.error) setSel({ kind: 'project', id: res.state.world.projects.at(-1)?.id ?? null });
                  }} />;
                  return <ProjectDetail key={p.id} project={p} world={world} act={act}
                    onAddRepo={() => { setAddErr(''); setSel({ kind: 'add-repo', id: p.id }); }}
                    onRemoved={() => setSel({ kind: 'project', id: world.projects.find((x) => x.id !== p.id)?.id ?? null })}
                    onSelectRepo={(id) => setSel({ kind: 'repo', id })} />;
                })()}
              </div>
            </div>
          </section>
        )}

        {view === 'customers' && (
          <section className="view on">
            <div className="intro">
              <h1>Customers</h1>
              Each customer’s contract sets its SLA per severity. An environment’s deadline is the strictest SLA among the customers on it.
            </div>
            <div className="panel">
              <CustomerTable world={world} act={act} />
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => act({ type: 'add-customer' })}>Add customer</button>
              </div>
            </div>
          </section>
        )}

        {view === 'environments' && (
          <section className="view on">
            <div className="intro">
              <h1>Environments</h1>
              Order environments the way releases move through them. Their rules decide who gets alerted. The fallback SLA applies only when no customer is on the environment.
            </div>
            <div className="pipeline">
              {world.envs.map((e, i) => {
                const n = world.envs.length;
                return (
                  <div className="panel env-card" key={e.id}>
                    <div className="head">
                      <span className="pos">{i + 1} of {n}</span>
                      <Field className="name" aria-label="Environment name" value={e.name}
                        onSave={(v) => act({ type: 'env-field', envId: e.id, field: 'name', value: v })} />
                      <span className="muted small">{i === n - 1 ? 'Most critical' : i === 0 ? 'Least critical' : ''}</span>
                      <span className="spacer" />
                      <button className="btn sm" disabled={i === 0} onClick={() => act({ type: 'env-move', envId: e.id, delta: -1 })}>Move earlier</button>
                      <button className="btn sm" disabled={i === n - 1} onClick={() => act({ type: 'env-move', envId: e.id, delta: 1 })}>Move later</button>
                      <button className="btn sm danger" disabled={n === 1} onClick={() => act({ type: 'env-remove', envId: e.id })}>Remove</button>
                    </div>
                    <fieldset>
                      <legend>Fallback SLA when no customer is on it (hours, empty means none)</legend>
                      <div className="grid4">
                        {SEVS.map((s) => (
                          <label className="f" key={s}>
                            <span><span className={`sev ${s}`}>{s}</span></span>
                            <Field type="number" min={1} placeholder="none" value={e.sla[s] == null ? '' : String(e.sla[s])}
                              onSave={(v) => act({ type: 'env-sla', envId: e.id, sev: s, hours: v === '' ? null : parseInt(v, 10) })} />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend>When this environment is affected</legend>
                      <Switch checked={e.ticket} label="Open a ticket" onChange={(v) => act({ type: 'env-field', envId: e.id, field: 'ticket', value: v })} />
                      <div className="grid2">
                        <Switch checked={e.slack} label="Post to Slack" onChange={(v) => act({ type: 'env-field', envId: e.id, field: 'slack', value: v })} />
                        <label className="f" style={{ margin: '0 0 8px' }}>
                          <Field value={e.channel} aria-label="Slack channel" disabled={!e.slack}
                            onSave={(v) => act({ type: 'env-field', envId: e.id, field: 'channel', value: v })} />
                        </label>
                      </div>
                      <label className="f" style={{ maxWidth: 320 }}>
                        <span>Page on-call</span>
                        <select value={e.page} onChange={(ev) => act({ type: 'env-field', envId: e.id, field: 'page', value: ev.target.value })}>
                          {[['never', 'Never'], ['critical', 'Critical only'], ['high', 'High and critical']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                    </fieldset>
                  </div>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={() => act({ type: 'env-add' })}>Add environment</button>
            </div>
          </section>
        )}

        {view === 'lab' && (
          <LabView draft={draft} setDraft={setDraft} world={world} allRepos={allRepos} now={now}
            onPreset={(i) => setDraft({ ...PRESETS[i]! })}
            onFire={async () => {
              const incident: Incident = { ...draft, package: draft.package.trim(), id: draft.id.trim() };
              const res = await act({ type: 'fire', incident });
              if (res.error) return;
              setDraft({ ...draft, id: 'DEMO-2026-' + String(Math.floor(1000 + Math.random() * 9000)) });
              setRunSel(res.runId ?? null);
              window.history.replaceState(null, '', '#runs');
              setView('runs');
              window.scrollTo({ top: 0 });
            }}
            flash={flash} />
        )}

        {view === 'runs' && (
          <section className="view on">
            <div className="intro">
              <h1>Runs</h1>
              Each incident runs through the 8 steps. Approve the customer text, then work through the fixes in priority order.
            </div>
            <div className="cols">
              <ul className="run-list">
                {runs.map((r) => {
                  const { aff, done, escd } = runSummary(r);
                  return (
                    <li key={r.id}>
                      <button className="run-item" data-testid="run-item" aria-current={run?.id === r.id ? 'true' : 'false'} onClick={() => setRunSel(r.id)}>
                        <span className="t"><span className="mono">{r.incident.id}</span><span className={`sev ${r.incident.severity}`}>{r.incident.severity}</span></span>
                        <span className="tally">
                          {r.incident.package}, {aff.length
                            ? <><b>{aff.length} affected</b>, {done} verified{escd ? `, ${escd} escalated` : ''}</>
                            : 'nothing affected'}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {runs.length === 0 && <li className="empty small">No runs yet.</li>}
              </ul>
              <div className="panel">
                {run
                  ? <RunDetail run={run} now={now} act={act} openPr={openPr} setOpenPr={setOpenPr} />
                  : <div className="empty"><p>No runs yet. Fire a hook from the incident lab to start the workflow.</p><a className="btn primary" href="#lab">Open incident lab</a></div>}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span>Demo data lives in the database. Grouping and fixing are simulated in this mock; the real Routine uses an LLM and a sandbox.</span>
        <button className="btn" data-testid="reset" onClick={async () => {
          if (!armed) {
            setArmed(true);
            clearTimeout(armTimer.current);
            armTimer.current = setTimeout(() => setArmed(false), 3000);
            return;
          }
          setArmed(false);
          const res = await act({ type: 'reset' });
          if (!res.error) { setSel({ kind: 'project', id: res.state.world.projects[0]?.id ?? null }); setRunSel(null); setOpenPr({}); flash('Demo data reset'); }
        }}>{armed ? 'Click again to reset' : 'Reset demo data'}</button>
      </footer>
      <div id="toast" role="status" aria-live="polite" className={toast ? 'on' : ''}>{toast}</div>
    </>
  );
}

function Header({ world, runs, view }: { world: World; runs: Run[]; view: View }) {
  const repos = world.projects.flatMap((p) => p.repos);
  const watched = repos.filter((r) => r.watched).length;
  return (
    <header className="top">
      <div className="wrap">
        <div className="bar">
          <div className="brand">
            <svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor">
              <ellipse cx="16" cy="21" rx="7" ry="6" /><ellipse cx="7" cy="13" rx="3" ry="4" /><ellipse cx="25" cy="13" rx="3" ry="4" />
              <ellipse cx="12" cy="6.5" rx="2.8" ry="3.8" /><ellipse cx="20" cy="6.5" rx="2.8" ry="3.8" />
            </svg>
            Bloodhound
          </div>
          <div className="status"><span className="live" aria-hidden="true" /><span id="status-text">
            Hook listening. Watching {watched} of {repos.length} repos in {world.projects.length} projects for {world.customers.length} customers.
          </span></div>
        </div>
        <nav aria-label="Sections">
          {VIEWS.map((v) => (
            <a key={v} href={`#${v}`} aria-current={view === v ? 'page' : undefined}>
              {LABEL[v]}
              {v === 'runs' && <span className="count">{runs.length}</span>}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function AddProject({ onCreate }: { onCreate: (name: string, owner: string) => void }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  return (
    <>
      <h2>Add a project</h2>
      <label className="f"><span>Project name</span><input value={name} placeholder="e.g. Customer portal" onChange={(e) => setName(e.target.value)} /></label>
      <label className="f"><span>Owning team</span><input value={owner} placeholder="e.g. Team Portal" onChange={(e) => setOwner(e.target.value)} /></label>
      <button className="btn primary" onClick={() => onCreate(name, owner)}>Create project</button>
    </>
  );
}

function ProjectDetail({ project: p, world, act, onAddRepo, onRemoved, onSelectRepo }: {
  project: Project; world: World; act: Act;
  onAddRepo: () => void; onRemoved: () => void; onSelectRepo: (id: string) => void;
}) {
  return (
    <>
      <div className="grid2">
        <label className="f"><span>Project</span><Field value={p.name} onSave={(v) => act({ type: 'project-field', projectId: p.id, field: 'name', value: v })} /></label>
        <label className="f"><span>Owner</span><Field value={p.owner} onSave={(v) => act({ type: 'project-field', projectId: p.id, field: 'owner', value: v })} /></label>
      </div>
      <h3>Environments and customers</h3>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Environment</th><th>Customers</th>{SEVS.map((s) => <th key={s}><span className={`sev ${s}`}>{s}</span></th>)}</tr></thead>
        <tbody>{world.envs.map((e) => {
          const ids = envCustomers(p, e.id);
          const others = world.customers.filter((c) => !ids.includes(c.id));
          return (
            <tr key={e.id}>
              <td><strong>{e.name}</strong></td>
              <td style={{ whiteSpace: 'normal', minWidth: 220 }}>
                {ids.map((id) => {
                  const c = world.customers.find((x) => x.id === id);
                  return c ? (
                    <span className="cchip" key={id}>{c.name} <span className="tier">{c.tier}</span>
                      <button aria-label={`Remove ${c.name}`} onClick={() => act({ type: 'env-customer', projectId: p.id, envId: e.id, customerId: id, add: false })}>×</button>
                    </span>
                  ) : null;
                })}
                {others.length > 0 && (
                  <select className="add" aria-label={`Add a customer to ${e.name}`} value="" onChange={(ev) => ev.target.value && act({ type: 'env-customer', projectId: p.id, envId: e.id, customerId: ev.target.value, add: true })}>
                    <option value="">Add customer…</option>
                    {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </td>
              {SEVS.map((s) => {
                const x = effSla(p, e.id, s, world.envs, world.customers);
                return (
                  <td key={s} className="slac">{fmtHours(x.hours)}<small>{x.by === 'fallback' ? 'fallback' : x.by ? 'from ' + x.by : ''}</small></td>
                );
              })}
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="note">Each deadline is the strictest SLA among the customers on that environment. With no customers, the environment’s fallback applies.</p>
      <h3>Repos</h3>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Repo</th><th>Ecosystem</th><th>Tests</th><th>Deployed to</th><th>Watched</th></tr></thead>
        <tbody>
          {p.repos.map((r) => (
            <tr key={r.id}>
              <td><button className="btn sm" onClick={() => onSelectRepo(r.id)}>{r.name}</button></td>
              <td>{r.ecosystem}</td>
              <td>{TESTS_LABEL[r.tests]}</td>
              <td>{world.envs.filter((e) => r.deployed[e.id]).map((e) => e.name).join(', ') || 'nowhere'}</td>
              <td>{r.watched ? 'Yes' : 'No'}</td>
            </tr>
          ))}
          {p.repos.length === 0 && <tr><td colSpan={5} className="muted">No repos yet.</td></tr>}
        </tbody>
      </table></div>
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" onClick={onAddRepo}>Add a repo</button>
        <button className="btn danger" onClick={async () => {
          const res = await act({ type: 'remove-project', projectId: p.id });
          if (!res.error) onRemoved();
        }}>Remove project</button>
      </div>
    </>
  );
}

function AddRepo({ project: p, mode, setMode, err, onBack, onFake, onManifest }: {
  project: Project; mode: 'fake' | 'manifest'; setMode: (m: 'fake' | 'manifest') => void; err: string;
  onBack: () => void; onFake: (eco: 'npm' | 'PyPI' | 'Go', name: string) => void; onManifest: (name: string, text: string) => void;
}) {
  const [eco, setEco] = useState<'npm' | 'PyPI' | 'Go'>('npm');
  const [name, setName] = useState('');
  const [mName, setMName] = useState('');
  const [text, setText] = useState('');
  return (
    <>
      <p className="small" style={{ margin: '0 0 6px' }}><button className="btn sm" onClick={onBack}>Back to {p.name}</button></p>
      <h2>Add a repo to {p.name}</h2>
      <div className="seg" role="group" aria-label="How to add">
        <button aria-pressed={mode === 'fake'} onClick={() => setMode('fake')}>Generate a fake repo</button>
        <button aria-pressed={mode === 'manifest'} onClick={() => setMode('manifest')}>Paste a manifest</button>
      </div>
      {mode === 'fake' ? (
        <>
          <div className="grid2">
            <label className="f"><span>Ecosystem</span>
              <select value={eco} onChange={(e) => setEco(e.target.value as 'npm' | 'PyPI' | 'Go')}>{ECOS.map((x) => <option key={x}>{x}</option>)}</select>
            </label>
            <label className="f"><span>Repo name (optional)</span><input value={name} placeholder="Random if empty" onChange={(e) => setName(e.target.value)} /></label>
          </div>
          <p className="note" style={{ marginTop: 0 }}>Picks real package names with a mix of vulnerable and patched versions. Later environments sometimes lag behind main.</p>
          <button className="btn primary" onClick={() => onFake(eco, name)}>Generate repo</button>
        </>
      ) : (
        <>
          <label className="f"><span>Repo name</span><input value={mName} placeholder="e.g. orders-service" onChange={(e) => setMName(e.target.value)} /></label>
          <label className="f"><span>package.json, package-lock.json, requirements.txt or go.mod</span>
            <textarea spellCheck={false} value={text} placeholder={'{ "name": "orders-service", "dependencies": { "lodash": "^4.17.15" } }'} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="note" style={{ marginTop: 0 }}>Every environment starts on the same versions as main. You can change them after the repo is added.</p>
          <button className="btn primary" onClick={() => onManifest(mName, text)}>Retrieve dependencies</button>
          <div className="err" role="alert">{err}</div>
        </>
      )}
    </>
  );
}

function RepoDetail({ repo: r, project: p, envs, onBack, act, onRemoved }: {
  repo: Repo; project: Project; envs: World['envs']; onBack: () => void; act: Act; onRemoved: () => void;
}) {
  const drift = envs.reduce((n, e) => n + r.deps.filter((d) => r.deployed[e.id] && verIn(d, e.id) !== d.version).length, 0);
  return (
    <>
      <p className="small" style={{ margin: '0 0 6px' }}><button className="btn sm" onClick={onBack}>Back to {p.name}</button></p>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ margin: 0, fontSize: 22 }}>{r.name}</h2>
        <Switch checked={r.watched} label={r.watched ? 'Watched' : 'Not watched'} onChange={(v) => act({ type: 'watch', repoId: r.id, watched: v })} />
      </div>
      <div className="row small muted" style={{ margin: '0 0 14px' }}>
        <span className="eco">{r.ecosystem}</span>
        <span>{r.deps.filter((d) => d.direct).length} direct and {r.deps.filter((d) => !d.direct).length} transitive dependencies.</span>
        <label>Test coverage <select className="inl" value={r.tests} onChange={(e) => act({ type: 'tests', repoId: r.id, tests: e.target.value as Tests })}>
          {(['good', 'some', 'none'] as Tests[]).map((t) => <option key={t} value={t}>{TESTS_LABEL[t]}</option>)}
        </select></label>
      </div>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Package</th><th>How it’s used</th><th className="envh">main</th>
          {envs.map((e) => (
            <th className="envh" key={e.id}>{e.name}
              <Field className="release" aria-label={`${e.name} release`} placeholder="release" value={r.releases[e.id] ?? ''}
                onSave={(v) => act({ type: 'release', repoId: r.id, envId: e.id, release: v })} />
              <Switch checked={!!r.deployed[e.id]} label="Deployed" onChange={(v) => act({ type: 'deploy', repoId: r.id, envId: e.id, deployed: v })} />
            </th>
          ))}
        </tr></thead>
        <tbody>{r.deps.map((d, i) => (
          <tr key={i}>
            <td className="mono">{d.name}</td>
            <td>{d.direct ? 'Direct' : <>Via <span className="mono">{d.via}</span></>}</td>
            <td><Field className="cell" aria-label={`${d.name} on main`} value={d.version} onSave={(v) => act({ type: 'cell', repoId: r.id, depIndex: i, envId: 'main', value: v })} /></td>
            {envs.map((e) => {
              const v = verIn(d, e.id);
              const cls = !r.deployed[e.id] ? 'off' : v !== d.version ? 'drift' : '';
              return (
                <td key={e.id} className={cls}>
                  <Field className="cell" aria-label={`${d.name} in ${e.name}`} value={v}
                    onSave={(nv) => act({ type: 'cell', repoId: r.id, depIndex: i, envId: e.id, value: nv })} />
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table></div>
      <p className="note">{drift ? `${drift} version${drift === 1 ? '' : 's'} in deployed environments differ from main (orange).` : 'Every deployed environment matches main.'} Edit a cell to set what an environment really runs; clear it to follow main again. Test coverage decides which repo is the safest pilot.</p>
      <div className="row" style={{ marginTop: 12 }}>
        {r.source === 'fake' && <button className="btn" onClick={() => act({ type: 'regen', repoId: r.id })}>Regenerate versions</button>}
        <button className="btn danger" onClick={async () => {
          const res = await act({ type: 'remove-repo', repoId: r.id });
          if (!res.error) onRemoved();
        }}>Remove repo</button>
      </div>
    </>
  );
}

function CustomerTable({ world, act }: { world: World; act: Act }) {
  const usedOn = (cid: string) => world.projects.flatMap((p) => world.envs.filter((e) => envCustomers(p, e.id).includes(cid)).map((e) => `${p.name} ${e.name}`));
  return (
    <>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Customer</th><th>Tier</th>{SEVS.map((s) => <th key={s}><span className={`sev ${s}`}>{s}</span> h</th>)}<th>Contact</th><th>“Not affected” notice</th><th>Uses</th><th /></tr></thead>
        <tbody>{world.customers.map((c) => (
          <tr key={c.id}>
            <td><Field className="inl" aria-label="Customer name" value={c.name} onSave={(v) => act({ type: 'customer-field', customerId: c.id, field: 'name', value: v })} /></td>
            <td><select className="inl" value={c.tier} onChange={(e) => act({ type: 'customer-tier', customerId: c.id, tier: e.target.value as Tier })}>
              {(Object.keys(TIERS) as Tier[]).map((t) => <option key={t}>{t}</option>)}
            </select></td>
            {SEVS.map((s) => (
              <td key={s}><Field className="inl num" type="number" min={1} placeholder="none" aria-label={`${s} SLA in hours`} value={c.sla[s] == null ? '' : String(c.sla[s])}
                onSave={(v) => act({ type: 'customer-sla', customerId: c.id, sev: s, hours: v === '' ? null : parseInt(v, 10) })} /></td>
            ))}
            <td><Field className="inl" aria-label="Contact" value={c.contact} onSave={(v) => act({ type: 'customer-field', customerId: c.id, field: 'contact', value: v })} /></td>
            <td><label className="check" style={{ margin: 0 }}>
              <input type="checkbox" checked={c.notifyUnaffected} onChange={(e) => act({ type: 'customer-field', customerId: c.id, field: 'notifyUnaffected', value: e.target.checked })} />Opt in
            </label></td>
            <td className="small" style={{ whiteSpace: 'normal', minWidth: 160 }}>{usedOn(c.id).join(', ') || 'not assigned'}</td>
            <td><button className="btn sm danger" onClick={() => act({ type: 'remove-customer', customerId: c.id })}>Remove</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="note">Changing the tier resets the SLA hours to that tier’s defaults. Assign customers to environments on each project.</p>
    </>
  );
}

function LabView({ draft: d, setDraft, world, allRepos, now, onPreset, onFire, flash }: {
  draft: Incident; setDraft: (d: Incident) => void; world: World; allRepos: { r: Repo; p: Project }[]; now: number;
  onPreset: (i: number) => void; onFire: () => void; flash: (m: string) => void;
}) {
  const pkgs = uniq(allRepos.filter((x) => x.r.ecosystem === d.ecosystem).flatMap((x) => x.r.deps.map((y) => y.name))).sort();
  const watched = allRepos.filter((x) => x.r.watched);
  const same = watched.filter((x) => x.r.ecosystem === d.ecosystem);
  const can = watched.length > 0 && d.package.trim() !== '' && d.id.trim() !== '';
  const set = (k: keyof Incident, v: string) => setDraft({ ...d, [k]: v } as Incident);
  return (
    <section className="view on">
      <div className="intro">
        <h1>Incident lab</h1>
        Write a fake security incident and fire the hook. The payload on the right is exactly what the real hook will receive.
      </div>
      <div className="cols even">
        <div className="panel">
          <h2>Presets</h2>
          <div className="presets">{PRESET_LABELS.map((label, i) => <button key={label} className="chip" onClick={() => onPreset(i)}>{label}</button>)}</div>
          <div className="grid2">
            <label className="f"><span>Incident ID</span><input className="mono" value={d.id} onChange={(e) => set('id', e.target.value)} /></label>
            <label className="f"><span>Severity</span><select value={d.severity} onChange={(e) => set('severity', e.target.value as Sev)}>{SEVS.map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          <label className="f"><span>Summary</span><input value={d.summary} onChange={(e) => set('summary', e.target.value)} /></label>
          <label className="f"><span>Details</span><input value={d.details} onChange={(e) => set('details', e.target.value)} /></label>
          <div className="grid2">
            <label className="f"><span>Ecosystem</span><select value={d.ecosystem} onChange={(e) => set('ecosystem', e.target.value)}>{ECOS.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="f"><span>Package</span><input list="pkg-list" value={d.package} onChange={(e) => set('package', e.target.value)} /></label>
          </div>
          <datalist id="pkg-list">{pkgs.map((p) => <option key={p} value={p} />)}</datalist>
          <div className="grid2">
            <label className="f"><span>Introduced in</span><input className="mono" value={d.introduced} placeholder="0 = all versions" onChange={(e) => set('introduced', e.target.value)} /></label>
            <label className="f"><span>Fixed in</span><input className="mono" value={d.fixed} placeholder="Empty = no fix yet" onChange={(e) => set('fixed', e.target.value)} /></label>
          </div>
          <div className="targets">
            {watched.length ? (
              <>
                <p>Will check main and each deployed environment of <strong>{watched.length}</strong> watched repos ({same.length} on {d.ecosystem}).</p>
                <p>Affected range: <span className="mono">{rangeText(d)}</span></p>
                <p className="muted small">Deadlines come from the customers on each affected environment.</p>
              </>
            ) : (
              <>No repos are watched. <a href="#projects">Switch on Watch</a> for at least one repo first.</>
            )}
          </div>
          <button className="btn fire" data-testid="fire" disabled={!can} onClick={onFire}>Fire hook</button>
        </div>
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Hook payload</h2>
            <button className="btn" onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(payload(d, now || Date.now()), null, 2))
                .then(() => flash('Copied to clipboard'), () => flash('Copy isn’t available here. Select the text and copy it manually.'));
            }}>Copy JSON</button>
          </div>
          <pre className="code">{JSON.stringify(payload(d, now || Date.now()), null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}

function RunDetail({ run, now, act, openPr, setOpenPr }: {
  run: Run; now: number; act: Act; openPr: Record<string, boolean>; setOpenPr: (o: Record<string, boolean>) => void;
}) {
  const inc = run.incident;
  const { aff } = runSummary(run);
  const rows = priority(run);
  const states = stepStates(run);
  const pending = run.notify.status === 'pending';
  const first = aff.filter((r) => r.sla?.hours != null).sort((a, b) => (a.sla!.hours! - b.sla!.hours!))[0];
  const runId = run.id;

  const Sec = ({ n, title, pill, children }: { n: number; title: string; pill?: ReactNode; children: ReactNode }) => (
    <section className="step" id={`step-${n}`}>
      <div className="sh"><span className="n">{n}</span><h3>{title}</h3>{pill}</div>
      {children}
    </section>
  );

  const byProj = uniq(run.results.map((r) => r.projectId)).map((pid) => run.results.filter((r) => r.projectId === pid));
  const rc0 = run.recipients[0];
  const next = rows.find(eligible);
  const escRows = rows.filter((x) => x.st.status === 'escalated');
  const unknown = run.results.filter((r) => r.verdict === 'unknown');

  return (
    <>
      <p className="headline">{aff.length} affected repo{aff.length === 1 ? '' : 's'}, {run.groups.length} distinct fix{run.groups.length === 1 ? '' : 'es'}, {run.recipients.length} customer{run.recipients.length === 1 ? '' : 's'} to notify</p>
      <p className="note" style={{ margin: 0 }}>
        {first
          ? <>First deadline: {fmtDue(run.firedAt + first.sla!.hours! * 3600e3)} for {first.sla!.env} of {first.projectName}{first.sla!.by && first.sla!.by !== 'fallback' ? `, set by ${first.sla!.by}’s contract` : ''}.</>
          : 'No deadline: nothing deployed is affected.'}
      </p>
      <div className="stepnav">
        {states.map(([t, s], i) => (
          <button key={t} className={s} onClick={() => document.getElementById('step-' + (i + 1))?.scrollIntoView({ block: 'start' })}>
            <b>{i + 1}</b>{t}
          </button>
        ))}
      </div>

      <Sec n={1} title="Incident">
        <p style={{ margin: 0 }}><span className="mono">{inc.id}</span> <span className={`sev ${inc.severity}`}>{inc.severity}</span> {inc.summary}</p>
        <p className="note">{inc.ecosystem}:{inc.package}, affected range <span className="mono">{rangeText(inc)}</span>. Received {new Date(run.firedAt).toLocaleString()}.</p>
      </Sec>

      <Sec n={2} title="Scan projects and environments" pill={<Pill text={`${aff.length} affected`} cls={aff.length ? 'bad' : 'ok'} />}>
        {byProj.map((rs) => {
          const shown = rs.filter((r) => r.verdict === 'affected' || r.verdict === 'unknown');
          const rest = rs.filter((r) => !shown.includes(r));
          return (
            <div className="projblock" key={rs[0]!.projectId}>
              <h4>{rs[0]!.projectName}</h4>
              {shown.map((r) => (
                <div className={`res ${r.verdict}`} style={{ marginBottom: 8 }} key={r.repoId}>
                  <div className="h"><strong>{r.repoName}</strong><span className="verdict">{VERDICT_LABEL[r.verdict]}</span>
                    {r.sla && r.sla.hours != null && (
                      <span className="sla">Fix in {r.sla.env} by {fmtDue(run.firedAt + r.sla.hours * 3600e3)}{r.sla.by && r.sla.by !== 'fallback' ? `, set by ${r.sla.by}` : ''}</span>
                    )}
                  </div>
                  <p>{r.note}</p>
                  <EnvStrip r={r} />
                </div>
              ))}
              {rest.length > 0 && <p className="note">Clear: {rest.map((r) => r.repoName).join(', ')}.</p>}
            </div>
          );
        })}
        {run.results.length === 0 && <p className="muted">No repos were watched.</p>}
      </Sec>

      <Sec n={3} title="Notify customers" pill={<Pill text={pending ? 'Needs approval' : run.notify.status === 'none' ? 'Nobody to notify' : 'Sent'} cls={pending ? 'warn' : 'ok'} />}>
        {run.notify.status === 'none'
          ? <p className="muted">No customer is on an affected environment, so nobody is notified.</p>
          : <NotifyBlock run={run} now={now} act={act} rc0={rc0} />}
      </Sec>

      <Sec n={4} title="Group repos" pill={<Pill text={`${aff.length} repos, ${run.groups.length} distinct fix${run.groups.length === 1 ? '' : 'es'}`} cls="info" />}>
        {run.groups.length ? (
          <>
            {run.groups.map((g) => (
              <div className="gcard" key={g.id}>
                <div className="h"><strong>{g.label}</strong><Pill text={`confidence ${g.confidence.toFixed(2)}`} /></div>
                <p>{g.rationale}</p>
                <p className="small muted">Repos: {g.members.map((id) => run.results.find((r) => r.repoId === id)?.repoName).join(', ')}</p>
              </div>
            ))}
            <p className="note">Simulated in this mock. The Routine groups with an LLM using each project’s context; groups below 0.6 confidence become single-repo groups.</p>
          </>
        ) : <p className="muted">Nothing to group.</p>}
      </Sec>

      <Sec n={5} title="Fix recipes" pill={<Pill text={states[4]![2]} cls={states[4]![1] === 'done' ? 'ok' : 'warn'} />}>
        {run.groups.length ? run.groups.map((g) => {
          const r = g.recipe;
          return (
            <div className="gcard" key={g.id}>
              <div className="h"><strong>{g.label}</strong><Pill text={r.strategy} /><Pill text={'Complexity ' + r.complexity} /><Pill text={`${r.confidence}, v${r.version}`} cls={r.confidence === 'Validated' ? 'ok' : 'warn'} /></div>
              <ol>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <p><strong>Breaking changes:</strong> {r.breaking}</p>
              <p className="small muted">Verified when: {r.verify.join(', ')}.</p>
              {r.learnings.length > 0 && <div className="learn">{r.learnings.map((l) => <div key={l.v}><strong>v{l.v}:</strong> {l.text}</div>)}</div>}
            </div>
          );
        }) : <p className="muted">No recipes needed.</p>}
      </Sec>

      <Sec n={6} title="Prioritise" pill={<Pill text="Recalculated after every repo" />}>
        {rows.length ? (
          <>
            <div className="tbl-wrap"><table>
              <thead><tr><th>#</th><th>Repo</th><th>Deadline</th><th>Complexity</th><th>Customers</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>{rows.map((x, i) => (
                <tr key={x.r.repoId} style={{ opacity: FINAL.includes(x.st.status) ? 0.55 : 1 }}>
                  <td>{i + 1}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 180 }}><strong>{x.r.repoName}</strong><br /><span className="small muted">{x.r.projectName}, {x.g.label}</span></td>
                  <td className="small">{dueText(run.firedAt, x.r.sla?.hours ?? null)}</td>
                  <td>{x.g.recipe.complexity}</td>
                  <td>{custCount(x.r)}</td>
                  <td>{x.role}{x.role === 'Pilot' && x.g.pilot?.review ? ' (review)' : ''}</td>
                  <td><Pill text={PILL[x.st.status]![0]} cls={PILL[x.st.status]![1]} /></td>
                </tr>
              ))}</tbody>
            </table></div>
            {run.groups.filter((g) => g.pilot).map((g) => (
              <p className="note" key={g.id}><strong>{g.label}:</strong> pilot is {run.results.find((r) => r.repoId === g.pilot!.id)?.repoName}. {g.pilot!.reason}</p>
            ))}
          </>
        ) : <p className="muted">Nothing to prioritise.</p>}
      </Sec>

      <Sec n={7} title="Fix repos" pill={<Pill text={states[6]![2]} cls={states[6]![1] === 'done' ? 'ok' : 'warn'} />}>
        {rows.length ? (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="btn primary" data-testid="run-next" disabled={!next}
                onClick={() => act({ type: 'run-next', runId })}>
                {next ? `Run next: ${next.r.repoName} (${next.role.toLowerCase()})` : 'Nothing left to run'}
              </button>
              <button className="btn" data-testid="run-all" disabled={!next} onClick={() => act({ type: 'run-all', runId })}>Run all</button>
            </div>
            {rows.filter((x) => x.st.status !== 'queued' || x.st.log.length > 0).map((x) => {
              const key = run.id + x.r.repoId;
              return (
                <div className="fixrow" key={key}>
                  <div className="h">
                    <strong>{x.r.repoName}</strong>
                    <Pill text={PILL[x.st.status]![0]} cls={PILL[x.st.status]![1]} />
                    <span className="small muted">{x.role}, {x.st.attempts} attempt{x.st.attempts === 1 ? '' : 's'}</span>
                    <span style={{ flex: 1 }} />
                    {['pr', 'deploy-ready', 'verified'].includes(x.st.status) && x.g.strategy !== 'nofix' && (
                      <button className="btn sm" onClick={() => setOpenPr({ ...openPr, [key]: !openPr[key] })}>
                        {x.g.strategy === 'deploy' ? 'Deploy request' : 'Pull request'}
                      </button>
                    )}
                    {x.st.status === 'pr' && <button className="btn sm primary" data-testid="verify" onClick={() => act({ type: 'verify', runId, repoId: x.r.repoId })}>Merge and deploy</button>}
                    {x.st.status === 'deploy-ready' && <button className="btn sm primary" data-testid="verify" onClick={() => act({ type: 'verify', runId, repoId: x.r.repoId })}>Approve deploy</button>}
                  </div>
                  {x.st.log.length > 0 && <div className="log">{x.st.log.map((l, i) => <div key={i}>{l}</div>)}</div>}
                  {openPr[key] && <pre className="code" style={{ marginTop: 8 }}>{prText(run, x.r, x.g)}</pre>}
                </div>
              );
            })}
            <p className="note">Simulated: repos without tests fail on anything bigger than a patch update. Merging and deploying stay human; a repo counts as fixed only after the deployed release is re-scanned.</p>
          </>
        ) : <p className="muted">Nothing to fix.</p>}
      </Sec>

      <Sec n={8} title="Escalate" pill={<Pill text={`${escRows.length} escalated`} cls={escRows.length ? 'bad' : 'ok'} />}>
        {escRows.length || unknown.length ? (
          <>
            {escRows.map((x: PlannedRow) => (
              <div className="fixrow" key={x.r.repoId}>
                <div className="h"><strong>{x.r.repoName}</strong><Pill text={`Ticket for ${x.r.owner}`} cls="bad" /></div>
                <p className="small">{x.st.reason}</p>
                <pre className="code">{ticketText(run, x.r, x.g)}</pre>
              </div>
            ))}
            {unknown.map((r: RepoResult) => (
              <div className="fixrow" key={r.repoId}>
                <div className="h"><strong>{r.repoName}</strong><Pill text="Manual check" cls="warn" /></div>
                <p className="small">{r.note}</p>
              </div>
            ))}
          </>
        ) : <p className="muted">Nothing escalated.</p>}
      </Sec>

      <details>
        <summary>Result JSON (what the Routine writes to its state)</summary>
        <pre className="code">{JSON.stringify({
          run_id: run.id, incident: inc.id, fired_at: new Date(run.firedAt).toISOString(),
          notification: { status: run.notify.status, recipients: run.recipients.map((rc) => run.custs.find((c) => c.id === rc.id)?.name) },
          groups: run.groups.map((g) => ({ label: g.label, members: g.members.map((id) => run.results.find((r) => r.repoId === id)?.repoName), confidence: g.confidence, recipe: { strategy: g.recipe.strategy, complexity: g.recipe.complexity, version: g.recipe.version, confidence: g.recipe.confidence } })),
          repos: rows.map((x) => ({ repo: x.r.repoName, project: x.r.projectName, role: x.role, status: x.st.status, due: x.r.sla?.hours != null ? new Date(run.firedAt + x.r.sla.hours * 3600e3).toISOString() : null })),
        }, null, 2)}</pre>
      </details>
    </>
  );
}

function EnvStrip({ r }: { r: RepoResult }) {
  if (!r.main) return null;
  const cell = (name: string, x: { state: string; dep: { version: string } | null }, rel: string, extra?: ReactNode) => (
    <div className={`e ${x.state}`} key={name}>
      <b>{name}</b>
      <span className="v">{x.dep ? x.dep.version : 'not deployed'}{rel ? ' · ' + rel : ''}</span><br />
      <span className="st">{VERDICT_LABEL[x.state]}</span>{extra}
    </div>
  );
  return (
    <div className="envs">
      {cell('main', r.main, '')}
      {r.envs.map((x) => cell(x.name, x, x.release, x.state === 'affected'
        ? <><br /><span className="small muted">{x.customers.length} customer{x.customers.length === 1 ? '' : 's'}, {fmtHours(x.slaHours)}</span></>
        : undefined))}
    </div>
  );
}

function NotifyBlock({ run, now, act, rc0 }: {
  run: Run; now: number; act: Act; rc0: Run['recipients'][number] | undefined;
}) {
  const [subject, setSubject] = useState(run.notify.subject);
  const [body, setBody] = useState(run.notify.body);
  useEffect(() => { setSubject(run.notify.subject); setBody(run.notify.body); }, [run.id, run.notify.subject, run.notify.body]);
  const pending = run.notify.status === 'pending';
  const count = run.recipients.length + run.unaffected.length;
  const preview = rc0 ? (() => {
    const v = recipientVars(run, rc0);
    return fill(subject, v) + '\n\n' + fill(body, v);
  })() : '';
  return (
    <>
      <p className="note" id="wait">{waitText(run, now)}</p>
      {pending && (
        <>
          <label className="f"><span>Subject</span>
            <input className="tpl" value={subject} onChange={(e) => setSubject(e.target.value)}
              onBlur={() => act({ type: 'set-tpl', runId: run.id, part: 'notify', field: 'subject', value: subject })} />
          </label>
          <label className="f"><span>Text, approved once and personalised for each customer: {'{customer}, {project}, {environment}, {deadline}, {incident}, {severity}'}</span>
            <textarea className="tpl" value={body} onChange={(e) => setBody(e.target.value)}
              onBlur={() => act({ type: 'set-tpl', runId: run.id, part: 'notify', field: 'body', value: body })} />
          </label>
          {rc0 && <details><summary>Preview for {run.custs.find((c) => c.id === rc0.id)?.name}</summary><pre className="code">{preview}</pre></details>}
        </>
      )}
      <div className="tbl-wrap" style={{ marginTop: 12 }}><table>
        <thead><tr><th>Customer</th><th>Affected</th><th>Deadline</th><th>Contact</th></tr></thead>
        <tbody>
          {run.recipients.map((rc) => {
            const c = run.custs.find((x) => x.id === rc.id);
            return (
              <tr key={rc.id}>
                <td>{c?.name} <span className="tier">{c?.tier}</span></td>
                <td>{rc.items.map((i) => `${i.project} ${i.env}`).join(', ')}</td>
                <td>{dueText(run.firedAt, rc.due)}</td>
                <td className="small">{c?.contact}</td>
              </tr>
            );
          })}
          {run.unaffected.map((id) => {
            const c = run.custs.find((x) => x.id === id);
            return (
              <tr key={id}>
                <td>{c?.name} <span className="tier">{c?.tier}</span></td>
                <td className="muted">Not affected, opted in to a notice</td><td />
                <td className="small">{c?.contact}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {pending && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" data-testid="approve-notify" onClick={() => act({ type: 'approve-notify', runId: run.id, subject, body })}>
            Approve text and send to {count} customer{count === 1 ? '' : 's'}
          </button>
        </div>
      )}
      <ResolutionBlock run={run} act={act} />
      {run.outbox.length > 0 && (
        <>
          <h3>Outbox ({run.outbox.length})</h3>
          <div className="outbox">{run.outbox.map((m, i) => <details key={i}><summary>{m.to}: {m.subject}</summary><pre className="code">{m.body}</pre></details>)}</div>
        </>
      )}
    </>
  );
}

function ResolutionBlock({ run, act }: { run: Run; act: Act }) {
  const ready = resolvable(run);
  const [subject, setSubject] = useState(run.resolution.subject);
  const [body, setBody] = useState(run.resolution.body);
  useEffect(() => { setSubject(run.resolution.subject); setBody(run.resolution.body); }, [run.id, run.resolution.subject, run.resolution.body]);
  if (!ready.length && !run.resolution.sent.length) return null;
  const pending = run.notify.status === 'pending';
  return (
    <>
      <h3>Resolution notice</h3>
      {ready.length > 0 && (
        <>
          <p className="note">{ready.length} customer{ready.length === 1 ? ' has' : 's have'} every affected project verified as fixed.</p>
          <label className="f"><span>Subject</span>
            <input className="tpl" value={subject} onChange={(e) => setSubject(e.target.value)}
              onBlur={() => act({ type: 'set-tpl', runId: run.id, part: 'resolution', field: 'subject', value: subject })} />
          </label>
          <label className="f"><span>Text</span>
            <textarea className="tpl" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)}
              onBlur={() => act({ type: 'set-tpl', runId: run.id, part: 'resolution', field: 'body', value: body })} />
          </label>
          <button className="btn primary" data-testid="approve-resolution" disabled={pending}
            onClick={() => act({ type: 'approve-resolution', runId: run.id, subject, body })}>
            Approve text and send to {listText(ready.map((rc) => run.custs.find((c) => c.id === rc.id)?.name ?? '?'))}
          </button>
          {pending && <p className="note">Send the advisory first.</p>}
        </>
      )}
      {run.resolution.sent.length > 0 && (
        <p className="note">Resolution sent to {listText(run.resolution.sent.map((id) => run.custs.find((c) => c.id === id)?.name ?? '?'))}.</p>
      )}
    </>
  );
}
