/**
 * The external issue a TimeHuddle ticket is linked to.
 *
 * Only the source and the issue's id are stored on the ticket — never its
 * subject, status or any other content, which each viewer reads live with
 * their own key (see docs/redmine-design.md, "What is stored").
 *
 * Its own module because both ticket normalizers need it — `toTicket` in
 * `api.ts` and `ddpDocToTicket` in `ddp.ts` — and each whitelists fields, so a
 * link dropped by either one vanishes from the page.
 */
export interface LinkedIssue {
  source: 'redmine';
  /** The Redmine issue number, as a string — the form My Board and timers use. */
  id: string;
}

const REDMINE_ISSUE_ID = /^[1-9]\d*$/;

/** A stored `linkedIssue` value as a `LinkedIssue`, or null when absent or malformed. */
export function toLinkedIssue(raw: unknown): LinkedIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const { source, id } = raw as { source?: unknown; id?: unknown };
  if (source !== 'redmine') return null;
  const issueId = String(id ?? '');
  return REDMINE_ISSUE_ID.test(issueId) ? { source, id: issueId } : null;
}
