/**
 * Source-aware ticket references.
 *
 * A `WorkItem` carries `{ source, ticketId }`, because a Redmine issue id (`42`)
 * and a Huddle ticket id are drawn from different namespaces and would otherwise
 * collide. This module is the single place that knows how to:
 *
 *   1. normalize a source (older rows have no `source` field and are Huddle by
 *      definition),
 *   2. check that the caller may actually time a given ticket, and
 *   3. resolve a ref to the display title + link a read path renders.
 *
 * (2) and (3) are the same lookup, so `resolveTicketRef` does both: it throws
 * when the ticket is not usable and returns its display fields when it is.
 * Nothing here is ever persisted onto the `WorkItem` — titles are resolved at
 * read time (Core Model Data Discipline).
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { RedmineLinks, Tickets, Teams, isValidId } from './collections';
import {
  findRedmineAccount,
  requireRedmineAccount,
  tooManyRedmineRequests,
} from './redmine-account';
import {
  getIssue,
  isRedmineBudgetExhausted,
  linkedRedmineBaseUrl,
  listIssuesByIds,
  optionalRedmineBaseUrl,
} from './redmine-client';

export const HUDDLE = 'huddle';
export const REDMINE = 'redmine';

const KNOWN_SOURCES = new Set([HUDDLE, REDMINE]);

/** Redmine issue ids are always positive integers; anything else is not one. */
const REDMINE_ID = /^[1-9]\d*$/;

/**
 * Whether `value` is a Redmine issue id, whether it arrives as a number (a
 * Meteor method argument) or as a string (a stored `WorkItem.ticketId`). The one
 * definition, so a guard added elsewhere cannot drift from this one.
 */
export function isRedmineIssueId(value) {
  return REDMINE_ID.test(String(value));
}

/**
 * Normalize a source supplied by a caller or read off a stored row.
 * Missing means Huddle: that is what every `WorkItem` without one is.
 */
export function normalizeSource(source) {
  if (source === undefined || source === null || source === '') return HUDDLE;
  if (!KNOWN_SOURCES.has(source)) {
    throw new Meteor.Error('bad-request', `Unknown ticket source: ${source}`);
  }
  return source;
}

/**
 * Mongo selector fragment matching exactly one source. Huddle also matches rows
 * with no `source` field at all, so older work items keep resolving.
 */
export function sourceSelector(source) {
  return source === HUDDLE ? { source: { $in: [HUDDLE, null] } } : { source };
}

/** `${source}:${ticketId}` — the same identity key My Board and the UI use. */
export const refKey = (source, ticketId) => `${source}:${ticketId}`;

const huddleDisplay = (title, ticketId) => ({
  title: title ?? null,
  url: `/app/tickets/${ticketId}`,
});

const redmineDisplay = (subject, issueId, baseUrl) => ({
  title: subject ?? null,
  url: baseUrl ? `${baseUrl}/issues/${issueId}` : null,
});

/**
 * Check that `userId` may track time against one ticket, and return how to
 * display it (`{ title, url }`). Throws a distinct `Meteor.Error` otherwise.
 *
 * Huddle tickets are gated on team membership. Redmine issues are not: an issue
 * is only ever reachable through the caller's own personal API key, so the key
 * seeing it *is* the authorization check, and there is no team to belong to.
 */
export async function resolveTicketRef(userId, source, ticketId) {
  if (source === REDMINE) {
    if (!isRedmineIssueId(ticketId)) {
      throw new Meteor.Error('not-found', 'Issue not found');
    }
    const account = await requireRedmineAccount(userId);
    let issue;
    try {
      issue = await getIssue(account, ticketId);
    } catch (err) {
      if (isRedmineBudgetExhausted(err)) throw tooManyRedmineRequests();
      if (err?.status === 401) throw new Meteor.Error('invalid-key', 'Your Redmine API key was rejected.');
      throw new Meteor.Error('unreachable', 'Could not reach Redmine.');
    }
    if (!issue) throw new Meteor.Error('not-found', 'Issue not found');
    return redmineDisplay(issue.subject, ticketId, account.baseUrl);
  }

  if (!isValidId(ticketId)) throw new Meteor.Error('not-found', 'Ticket not found');
  const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
  if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
  if (isValidId(ticket.teamId)) {
    const team = await Teams.findOneAsync({
      _id: new Mongo.ObjectID(ticket.teamId),
      $or: [{ members: userId }, { admins: userId }],
    });
    if (!team) throw new Meteor.Error('forbidden', 'Forbidden');
  }
  return huddleDisplay(ticket.title, ticketId);
}

/** The ids of the teams in `teamIds` that `userId` is a member or an admin of. */
export async function teamsOpenTo(userId, teamIds) {
  const ids = [...new Set(teamIds)].filter(isValidId);
  if (!ids.length) return new Set();
  const teams = await Teams.find(
    {
      _id: { $in: ids.map((id) => new Mongo.ObjectID(id)) },
      $or: [{ members: userId }, { admins: userId }],
    },
    { fields: { _id: 1 } },
  ).fetchAsync();
  return new Set(teams.map((team) => team._id.toHexString()));
}

/**
 * Resolve Huddle titles for a batch of ids, skipping ones that are not ObjectIds.
 * With `viewerId`, a ticket in a team that viewer does not belong to is left
 * out — the same team gate `resolveTicketRef` applies.
 */
async function resolveHuddleDisplays(ticketIds, into, viewerId = null) {
  const ids = ticketIds.filter(isValidId);
  if (!ids.length) return;
  const tickets = await Tickets.find(
    { _id: { $in: ids.map((id) => new Mongo.ObjectID(id)) } },
    { fields: { title: 1, teamId: 1 } },
  ).fetchAsync();
  const openTeams = viewerId
    ? await teamsOpenTo(
        viewerId,
        tickets.map((ticket) => ticket.teamId),
      )
    : null;
  for (const ticket of tickets) {
    if (openTeams && isValidId(ticket.teamId) && !openTeams.has(ticket.teamId)) continue;
    const id = ticket._id.toHexString();
    into.set(refKey(HUDDLE, id), huddleDisplay(ticket.title, id));
  }
}

/**
 * Resolve Redmine subjects for a batch of issue ids. Best-effort — see below.
 *
 * The ids are `ownerId`'s; the subjects are fetched with `viewerId`'s own key,
 * so Redmine decides what that viewer may read. An issue id means nothing on
 * another instance, so a viewer linked elsewhere gets no subjects at all.
 */
async function resolveRedmineDisplays(ownerId, viewerId, issueIds, into) {
  const ids = issueIds.filter(isRedmineIssueId);
  if (!ids.length) return;
  let account = await findRedmineAccount(viewerId);
  let baseUrl = account?.baseUrl ?? optionalRedmineBaseUrl();
  if (viewerId !== ownerId) {
    const ownerLink = await RedmineLinks.findOneAsync({ userId: ownerId }, { fields: { baseUrl: 1 } });
    const ownerBaseUrl = linkedRedmineBaseUrl(ownerLink?.baseUrl);
    if (account?.baseUrl !== ownerBaseUrl) account = null;
    baseUrl = ownerBaseUrl;
  }
  // Link out even when the subject cannot be fetched: an issue number plus a
  // working link is still useful, and a read path must not fail because a
  // third-party instance is down or the user unlinked their account.
  for (const id of ids) into.set(refKey(REDMINE, id), redmineDisplay(null, id, baseUrl));

  if (!account) return;
  let issues;
  try {
    issues = await listIssuesByIds(account, ids);
  } catch {
    return;
  }
  for (const issue of issues) {
    into.set(refKey(REDMINE, issue.id), redmineDisplay(issue.subject, issue.id, baseUrl));
  }
}

/**
 * Resolve display fields for many refs at once, as `Map<refKey, {title, url}>`.
 *
 * Unlike `resolveTicketRef` this never throws for an unresolvable ref: read
 * paths (day view, timesheet) render whatever they can and fall back to the
 * bare id, rather than blanking the page because one ticket went away.
 *
 * `viewerId` is who the result is for, when that is not the refs' owner (an
 * admin reading a member's timesheet). Titles are then resolved under the
 * viewer's own access, so a ticket the viewer could not open stays a bare id.
 *
 * @param {{source?: string, ticketId: string}[]} refs
 */
export async function resolveTicketRefs(userId, refs, viewerId = userId) {
  const display = new Map();
  const bySource = new Map([
    [HUDDLE, new Set()],
    [REDMINE, new Set()],
  ]);
  for (const ref of refs) {
    const source = normalizeSource(ref.source);
    if (ref.ticketId) bySource.get(source).add(String(ref.ticketId));
  }
  await Promise.all([
    resolveHuddleDisplays([...bySource.get(HUDDLE)], display, viewerId === userId ? null : viewerId),
    resolveRedmineDisplays(userId, viewerId, [...bySource.get(REDMINE)], display),
  ]);
  return display;
}
