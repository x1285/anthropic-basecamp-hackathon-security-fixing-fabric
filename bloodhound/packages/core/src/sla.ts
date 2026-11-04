import type { Severity } from './osv';

export interface CustomerSla {
  id: string;
  slaHours: Partial<Record<Severity, number>>;
}

export interface EnvSla {
  hours: number;
  source: 'customers' | 'floor';
  strictestCustomerId?: string;
}

/**
 * Effective SLA of an environment: the strictest customer SLA for the severity.
 * Environments without customers fall back to the environment's rule floor.
 */
export function effectiveSla(severity: Severity, customers: CustomerSla[], slaFloorHours: number): EnvSla {
  const withSla = customers
    .map((c) => ({ id: c.id, hours: c.slaHours[severity] }))
    .filter((c): c is { id: string; hours: number } => typeof c.hours === 'number');
  if (withSla.length === 0) return { hours: slaFloorHours, source: 'floor' };
  const strictest = withSla.reduce((a, b) => (b.hours < a.hours ? b : a));
  return { hours: strictest.hours, source: 'customers', strictestCustomerId: strictest.id };
}

export interface SlaStatus {
  deadline: Date;
  elapsedFraction: number;
  remainingHours: number;
  alarm: boolean;
  breached: boolean;
}

/** The clock starts at detection; approval waiting time counts. */
export function slaStatus(detectedAt: Date, hours: number, now: Date, alarmAt = 0.5, hasTestedPr = false): SlaStatus {
  const totalMs = hours * 3600_000;
  const deadline = new Date(detectedAt.getTime() + totalMs);
  const elapsedFraction = (now.getTime() - detectedAt.getTime()) / totalMs;
  return {
    deadline,
    elapsedFraction,
    remainingHours: (deadline.getTime() - now.getTime()) / 3600_000,
    alarm: !hasTestedPr && elapsedFraction >= alarmAt,
    breached: now.getTime() > deadline.getTime(),
  };
}

/** Approval escalation: the backup approver is pinged after this share of the SLA. */
export function approvalPingDue(detectedAt: Date, hours: number, now: Date, escalateAt = 0.1): boolean {
  return (now.getTime() - detectedAt.getTime()) / (hours * 3600_000) >= escalateAt;
}
