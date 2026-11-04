import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOCKDATA } from '@bloodhound/engine';
import { fireMockIncident, fireCustomIncident } from '../actions';

export const dynamic = 'force-dynamic';

export default function Lab() {
  const dir = join(MOCKDATA, 'incidents');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  return (
    <>
      <h1>Demo-Lab</h1>
      <p className="muted">Incidents aus dem Mock-Katalog auslösen oder einen eigenen OSV-Payload einfügen.</p>
      <section>
        <h2>Mock-Katalog</h2>
        <table data-testid="catalog">
          <thead><tr><th>Datei</th><th>Summary</th><th></th></tr></thead>
          <tbody>
            {files.map((f) => {
              const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id: string; summary: string };
              return (
                <tr key={f} data-testid="catalog-row" data-file={f}>
                  <td>{p.id}</td>
                  <td>{p.summary}</td>
                  <td>
                    <form action={fireMockIncident}>
                      <input type="hidden" name="file" value={f} />
                      <button type="submit" data-testid="fire">Auslösen</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Eigener Payload</h2>
        <form action={fireCustomIncident}>
          <textarea name="payload" defaultValue={JSON.stringify({ id: 'OSV-CUSTOM-1', severity: 'LOW', affected: [{ package: { ecosystem: 'npm', name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }] }, null, 2)} />
          <p><button type="submit" data-testid="fire-custom">Auslösen</button></p>
        </form>
      </section>
    </>
  );
}
