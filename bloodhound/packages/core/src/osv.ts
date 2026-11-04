// OSV-style incident payloads, reduced to what Bloodhound uses.
export interface OsvPayload {
  id: string;
  summary?: string;
  detectedAt?: string;
  severity?: string;
  database_specific?: { severity?: string };
  affected: Array<{
    package: { ecosystem: string; name: string };
    ranges: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string }> }>;
  }>;
}

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Incident {
  id: string;
  packageName: string;
  ecosystem: string;
  introduced: string;
  fixedVersion: string | null;
  severity: Severity;
  summary: string;
  detectedAt: Date;
}

const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export function parseOsv(payload: OsvPayload): Incident {
  const aff = payload.affected?.[0];
  if (!aff) throw new Error(`payload ${payload.id} has no affected entry`);
  const events = aff.ranges?.[0]?.events ?? [];
  const introduced = events.find((e) => e.introduced !== undefined)?.introduced ?? '0';
  const fixed = events.find((e) => e.fixed !== undefined)?.fixed ?? null;
  const sev = (payload.database_specific?.severity ?? payload.severity ?? 'MEDIUM').toUpperCase() as Severity;
  return {
    id: payload.id,
    packageName: aff.package.name,
    ecosystem: aff.package.ecosystem,
    introduced,
    fixedVersion: fixed,
    severity: SEVERITIES.includes(sev) ? sev : 'MEDIUM',
    summary: payload.summary ?? '',
    detectedAt: payload.detectedAt ? new Date(payload.detectedAt) : new Date(),
  };
}

/** Affected when introduced <= v and (no fix, or v < fix). */
export function isAffected(
  incident: Pick<Incident, 'introduced' | 'fixedVersion'>,
  version: string,
  cmp: (a: string, b: string) => number,
): boolean {
  if (cmp(version, incident.introduced) < 0) return false;
  if (incident.fixedVersion === null) return true;
  return cmp(version, incident.fixedVersion) < 0;
}
