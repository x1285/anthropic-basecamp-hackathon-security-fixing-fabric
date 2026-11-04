// Domain model of Bloodhound, aligned with the target UI (Bloodhound.html).
// Pure types and constants: no I/O, no Node APIs, so the browser bundle can import this package too.

export type Eco = 'npm' | 'PyPI' | 'Go';
export const ECOS: Eco[] = ['npm', 'PyPI', 'Go'];

export type Sev = 'critical' | 'high' | 'medium' | 'low';
export const SEVS: Sev[] = ['critical', 'high', 'medium', 'low'];

export type Tests = 'good' | 'some' | 'none';
export type Tier = 'Gold' | 'Silver' | 'Standard';
export type PagePolicy = 'never' | 'critical' | 'high';
/** Hours per severity; null means "no SLA". */
export type Sla = Record<Sev, number | null>;

/** Affected state of one dependency against the incident range. 'unknown' = unpinned or unreadable version. */
export type MatchState = 'affected' | 'unknown' | 'patched';
export type EnvState = MatchState | 'none';
export type RepoVerdict = MatchState | 'clear';
export type Strategy = 'bump' | 'override' | 'deploy' | 'nofix';
export type Complexity = 'S' | 'M' | 'L';
export type RepoStatus = 'queued' | 'pr' | 'deploy-ready' | 'verified' | 'escalated';
export type Role = 'Pilot' | 'Rollout' | 'Waits for pilot' | 'Deploy' | 'Manual';

export interface Environment {
  id: string;
  name: string;
  /** Fallback SLA, used only when no customer is on the environment. */
  sla: Sla;
  ticket: boolean;
  slack: boolean;
  channel: string;
  page: PagePolicy;
}

export interface Customer {
  id: string;
  name: string;
  tier: Tier;
  sla: Sla;
  contact: string;
  notifyUnaffected: boolean;
}

export interface Dep {
  name: string;
  version: string;
  direct: boolean;
  /** Parent package for transitive deps, '' for direct ones. */
  via: string;
  /** Per-environment version overrides; a missing key follows main. */
  env: Record<string, string>;
}

export interface Repo {
  id: string;
  name: string;
  ecosystem: Eco;
  watched: boolean;
  source: 'seed' | 'fake' | 'manifest';
  tests: Tests;
  deployed: Record<string, boolean>;
  releases: Record<string, string>;
  deps: Dep[];
}

export interface Project {
  id: string;
  name: string;
  owner: string;
  repos: Repo[];
  /** Customers per environment id. */
  envs: Record<string, { customers: string[] }>;
}

export interface World {
  envs: Environment[];
  customers: Customer[];
  projects: Project[];
}

export interface Incident {
  id: string;
  severity: Sev;
  ecosystem: Eco;
  package: string;
  introduced: string;
  fixed: string;
  summary: string;
  details: string;
}

export interface Match {
  name: string;
  direct: boolean;
  via: string;
  version: string;
  state: MatchState;
}

export interface EnvResult {
  env: string;
  name: string;
  release: string;
  customers: string[];
  slaHours: number | null;
  slaBy: string | null;
  state: EnvState;
  dep: Match | null;
}

export interface RepoResult {
  repoId: string;
  repoName: string;
  projectId: string;
  projectName: string;
  owner: string;
  tests: Tests;
  verdict: RepoVerdict;
  note: string;
  fix: 'deploy' | 'code' | null;
  main: { state: MatchState; dep: Match } | null;
  envs: EnvResult[];
  sla: { env: string; hours: number | null; by: string | null } | null;
}

export interface Pilot {
  id: string;
  review: boolean;
  reason: string;
}

export interface Learning {
  v: number;
  kind: 'pilot' | 'partial' | 'revise';
  text: string;
}

export interface Recipe {
  strategy: string;
  complexity: Complexity;
  steps: string[];
  breaking: string;
  verify: string[];
  confidence: 'Validated' | 'Draft';
  version: number;
  learnings: Learning[];
}

export interface Group {
  id: string;
  key: string;
  strategy: Strategy;
  label: string;
  major: number | null;
  cur: string | null;
  via: string | null;
  members: string[];
  rationale: string;
  confidence: number;
  recipe: Recipe;
  pilot: Pilot | null;
  pilotDone: boolean;
  revisions: number;
}

export interface RepoState {
  status: RepoStatus;
  attempts: number;
  log: string[];
  pr: number | null;
  reason: string | null;
  recipeVersion: number | null;
}

export interface Recipient {
  id: string;
  items: { project: string; projectId: string; env: string; hours: number | null }[];
  /** Tightest deadline in hours; null = no SLA. */
  due: number | null;
}

export interface Notice {
  status: 'pending' | 'approved' | 'none';
  subject: string;
  body: string;
  approvedAt: number | null;
}

export interface OutboxMessage {
  to: string;
  subject: string;
  body: string;
}

export interface Run {
  id: string;
  firedAt: number;
  incident: Incident;
  /** Snapshots taken when the run started, so later edits do not change a run in progress. */
  envs: Environment[];
  custs: Customer[];
  results: RepoResult[];
  recipients: Recipient[];
  unaffected: string[];
  notify: Notice;
  resolution: { subject: string; body: string; sent: string[] };
  outbox: OutboxMessage[];
  groups: Group[];
  repoState: Record<string, RepoState>;
  prSeq: number;
}

export interface PlannedRow {
  r: RepoResult;
  g: Group;
  role: Role;
  st: RepoState;
}
