/**
 * Pure rules for a ticket's link to an external issue.
 *
 * A ticket stores `linkedIssue: { source, id }` and nothing else about the
 * issue (docs/redmine-design.md, "What is stored"). No Meteor imports, so this
 * is unit-testable (tests/ticket-link-core.test.ts).
 */
import { sumClosedSessions, ticketDayKey } from './redmine-net-hours';

/** The id of the issue a stored ticket is linked to, or null. */
export function linkedIssueIdOf(ticket) {
  const id = ticket?.linkedIssue?.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * The issue each session of a work item is logged under once the item has been
 * moved to another ticket, as `[{ sessionId, issueId }]` (`issueId` null for
 * none).
 *
 * A session follows the item to the new ticket's issue (`nextIssueId`) unless
 * time on the issue-day it was logged under has already been sent or discarded.
 * Those stay where they are: the push ledger is kept per issue-day, so a moved
 * session would count as unsent on the new issue and be sent a second time,
 * and an entry in Redmine can never be withdrawn.
 *
 * A session still running always follows the item: only closed time is ever
 * pushed, so none of it can have been sent, and what it goes on to record
 * belongs to the new ticket.
 *
 * @param {object} input
 * @param {Array<{_id: unknown, redmineIssueId?: string, date?: string, endTime?: number|null}>} input.sessions
 * @param {string} input.date  the work item's day, for a session without its own
 * @param {string|null} input.previousIssueId  the issue the item itself was on,
 *   when it was a Redmine entry whose sessions carry no stamp
 * @param {string|null} input.nextIssueId  the issue the new ticket is linked to
 * @param {Map<string, {seconds: number}>} input.ledger  `pushLedgerFor`
 */
export function sessionIssuesAfterMove({ sessions, date, previousIssueId, nextIssueId, ledger }) {
  return sessions.map((session) => {
    const was = session.redmineIssueId ?? previousIssueId ?? null;
    const closed = session.endTime != null;
    const handled =
      closed && was ? (ledger.get(ticketDayKey(was, session.date ?? date))?.seconds ?? 0) : 0;
    return { sessionId: session._id, issueId: handled > 0 ? was : (nextIssueId ?? null) };
  });
}

/**
 * Whether the ticket's link is still the one the caller last saw.
 * `expectedIssueId` is null (or absent) for "not linked". A mismatch means
 * someone else changed the link meanwhile, and writing now would undo it.
 */
export function matchesExpectedLink(ticket, expectedIssueId) {
  return linkedIssueIdOf(ticket) === (expectedIssueId == null ? null : String(expectedIssueId));
}

/** What a link change is called in the ticket's activity. */
export function linkAction(previousId, nextId) {
  if (!nextId) return 'unlinked';
  return previousId ? 'relinked' : 'linked';
}

/** "Ada", "Ada and Ben", "Ada, Ben and Cy" — with the caller shown as "You". */
function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Why a linked ticket cannot be changed right now: who is timing it.
 * `holders` is `[{ userId, name }]`; the caller reads as "You".
 */
export function lockMessage(holders, callerId) {
  const mine = holders.some((holder) => holder.userId === callerId);
  const others = holders.filter((holder) => holder.userId !== callerId).map((h) => h.name);
  const who = joinNames([...(mine ? ['You'] : []), ...others]);
  const verb = holders.length === 1 && !mine ? 'is' : 'are';
  const stop = holders.length === 1 && mine ? 'Stop your timer' : 'The timer has to be stopped';
  return `${who} ${verb} timing this ticket. ${stop} before it can be changed.`;
}

/**
 * The notification a teammate who logged time on a ticket gets when its link
 * changes. Names the issue by number only.
 * @param {{actorName: string, ticketTitle: string, action: string, issueId?: string, previousIssueId?: string}} change
 */
export function linkNotificationBody({ actorName, ticketTitle, action, issueId, previousIssueId }) {
  const ticket = `"${ticketTitle}", a ticket you worked on,`;
  if (action === 'unlinked') {
    return `${actorName} unlinked ${ticket} from Redmine #${previousIssueId}`;
  }
  if (action === 'relinked') {
    return `${actorName} moved ${ticket} from Redmine #${previousIssueId} to Redmine #${issueId}`;
  }
  return `${actorName} linked ${ticket} to Redmine #${issueId}`;
}

/**
 * How much of one person's time on a ticket is at stake when its link changes.
 *
 * - `unlinkedSeconds`: time logged while the ticket had no link. It belongs to
 *   no Redmine issue and stays in TimeHuddle.
 * - `unsentSeconds` / `sentSeconds`: time logged under the issue the ticket is
 *   linked to now (`issueId`), split by whether it has reached Redmine.
 *
 * Redmine holds one total per issue-day, and time timed on the issue itself or
 * on another ticket linked to it pools into the same day. The split for this
 * ticket is therefore read against that pool: unsent time is attributed to
 * this ticket first, so the figure never under-reports what is still to send.
 *
 * @param {object} input
 * @param {Array<{redmineIssueId?: string, date: string, endTime?: number|null, durationSeconds?: number}>} input.sessions
 *   the person's sessions on this ticket
 * @param {string|null} input.issueId  the issue the ticket is linked to now
 * @param {Array<{ticketId: string, date: string, seconds: number}>} [input.poolTotals]
 *   the person's issue-day totals (`redmineTicketDaysFor`)
 * @param {Map<string, {seconds: number, discardedSeconds: number}>} [input.ledger]
 *   what has been handled per issue-day (`pushLedgerFor`)
 */
export function linkedTimeSummary({ sessions, issueId, poolTotals = [], ledger = new Map() }) {
  const unlinkedSeconds = sumClosedSessions(sessions.filter((s) => !s.redmineIssueId));
  if (!issueId) return { unlinkedSeconds, unsentSeconds: 0, sentSeconds: 0 };

  const poolByKey = new Map(poolTotals.map((t) => [ticketDayKey(t.ticketId, t.date), t.seconds]));
  const byDate = new Map();
  for (const session of sessions) {
    if (session.redmineIssueId !== issueId) continue;
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session]);
  }

  let unsentSeconds = 0;
  let sentSeconds = 0;
  for (const [date, bucket] of byDate) {
    const mine = sumClosedSessions(bucket);
    const key = ticketDayKey(issueId, date);
    const held = ledger.get(key) ?? { seconds: 0, discardedSeconds: 0 };
    const poolUnsent = Math.max(0, (poolByKey.get(key) ?? mine) - held.seconds);
    const dayUnsent = Math.min(mine, poolUnsent);
    unsentSeconds += dayUnsent;
    // "Never send" time is handled but was not sent, so it is not counted here.
    sentSeconds += Math.min(mine - dayUnsent, Math.max(0, held.seconds - held.discardedSeconds));
  }
  return { unlinkedSeconds, unsentSeconds, sentSeconds };
}
