/**
 * The external issue a TimeHuddle ticket is linked to.
 *
 * Only the source, the issue's id and its server's host are stored on the
 * ticket — never its subject, status or any other content, which each viewer
 * reads live with their own key (see docs/redmine-design.md, "What is stored").
 *
 * Its own module because both ticket normalizers need it — `toTicket` in
 * `api.ts` and `ddpDocToTicket` in `ddp.ts` — and each whitelists fields, so a
 * link dropped by either one vanishes from the page.
 */
export interface LinkedIssue {
  source: 'redmine';
  /** The Redmine issue number, as a string — the form My Board and timers use. */
  id: string;
  /**
   * The Redmine server's hostname (#736). Absent on links made before it was
   * stored, which are on the deployment's own Redmine.
   */
  host?: string;
}

const REDMINE_ISSUE_ID = /^[1-9]\d*$/;

/** A stored `linkedIssue` value as a `LinkedIssue`, or null when absent or malformed. */
export function toLinkedIssue(raw: unknown): LinkedIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const { source, id, host } = raw as { source?: unknown; id?: unknown; host?: unknown };
  if (source !== 'redmine') return null;
  const issueId = String(id ?? '');
  if (!REDMINE_ISSUE_ID.test(issueId)) return null;
  return typeof host === 'string' && host ? { source, id: issueId, host } : { source, id: issueId };
}
