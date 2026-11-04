// Adapter interfaces for every external system. In this build only the fakes run.
// Real implementations (code host, mail, paging, tickets, deploy source) are later drop-in replacements.

export interface OutboundMail {
  to: string;
  subject: string;
  body: string;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<{ id: string }>;
}

export interface Pager {
  page(target: string, text: string): Promise<{ id: string }>;
}

export interface TicketDraft {
  title: string;
  assigneeTeam: string;
  body: string;
  checklist: string[];
}

export interface TicketSystem {
  create(draft: TicketDraft): Promise<{ id: string }>;
}

export interface PullRequestDraft {
  repoId: string;
  title: string;
  diff: string;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export interface CodeHost {
  openPullRequest(pr: PullRequestDraft): Promise<{ number: string }>;
}

export interface DeployedRelease {
  release: string;
  deployedAt: string;
  versions: Record<string, Record<string, string>>;
}

export interface DeploySource {
  releases(): Promise<Record<string, DeployedRelease>>;
}

// ---------- fakes ----------

export class FakeMailer implements Mailer {
  readonly sent: OutboundMail[] = [];
  async send(mail: OutboundMail): Promise<{ id: string }> {
    this.sent.push(mail);
    return { id: `fake-mail-${this.sent.length}` };
  }
}

export class FakePager implements Pager {
  readonly pages: Array<{ target: string; text: string }> = [];
  async page(target: string, text: string): Promise<{ id: string }> {
    this.pages.push({ target, text });
    return { id: `fake-page-${this.pages.length}` };
  }
}

export class FakeTickets implements TicketSystem {
  readonly tickets: TicketDraft[] = [];
  async create(draft: TicketDraft): Promise<{ id: string }> {
    this.tickets.push(draft);
    return { id: `FAKE-${String(this.tickets.length).padStart(4, '0')}` };
  }
}

export class FakeCodeHost implements CodeHost {
  readonly pulls: PullRequestDraft[] = [];
  async openPullRequest(pr: PullRequestDraft): Promise<{ number: string }> {
    this.pulls.push(pr);
    return { number: `SIM-PR-${String(this.pulls.length).padStart(3, '0')}` };
  }
}

/** Reads the deployed releases from a static file (mockdata/releases.json). */
export class MockReleaseSource implements DeploySource {
  constructor(private readonly data: Record<string, DeployedRelease>) {}
  async releases(): Promise<Record<string, DeployedRelease>> {
    return this.data;
  }
}

export interface Adapters {
  mailer: Mailer;
  pager: Pager;
  tickets: TicketSystem;
  codeHost: CodeHost;
  deploy: DeploySource;
}

export function createFakeAdapters(releases: Record<string, DeployedRelease> = {}): Adapters & {
  fakes: { mailer: FakeMailer; pager: FakePager; tickets: FakeTickets; codeHost: FakeCodeHost };
} {
  const fakes = { mailer: new FakeMailer(), pager: new FakePager(), tickets: new FakeTickets(), codeHost: new FakeCodeHost() };
  return { ...fakes, deploy: new MockReleaseSource(releases), fakes };
}
