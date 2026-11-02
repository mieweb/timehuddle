/**
 * The outside issue a ticket carries, read and written through the driver
 * engine (#734 step 3), with the member's own key: the source's permissions
 * and workflow decide what they see and may change.
 *
 * Any member of the ticket's team may ask. Nothing read here is stored but the
 * issue's title: the ticket's saved title follows it (`followTitle`).
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { github, matchIssueUrl } from '@timehuddle/ticket-sources';

import { requireIdentity } from './auth-bridge';
import { Tickets, isObjectIdHex } from './collections';
import { requireTeamMembership } from './permissions';
import { createRateLimiter } from './rate-limit';
import { enforceRedmineLimit } from './redmine';
import { EngineError, fetchRecord, writeRecord } from './sources/engine';
import { driverFor } from './sources/registry';

// As the old Redmine issue page: the ticket page reads again when its tab
// regains focus or a timer starts or stops, and each read is a few calls.
const readLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const writeLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

/** The ticket's outside issue, with the driver and the member's session for it. */
async function openOutside(userId, ticketId) {
  if (!isObjectIdHex(ticketId)) throw new Meteor.Error('not-found', 'Ticket not found');
  const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
  if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
  await requireTeamMembership(userId, ticket.teamId);

  const linkedFromAddress = !ticket.linkedIssue?.id && carriedLinkOf(ticket);
  const link = linkedFromAddress || ticket.linkedIssue;
  const driver = link?.id ? driverFor(link.source) : null;
  if (!driver) throw new Meteor.Error('not-linked', 'This ticket carries no outside issue.');
  let session;
  try {
    session = await driver.open(userId, link.host);
  } catch (err) {
    if (linkedFromAddress) throw notConnectedLink();
    throw err;
  }
  if (link.host && link.host !== session.server) {
    throw new Meteor.Error('other-server', 'This issue is on a server your account is not on.');
  }
  const ref = {
    server: link.host ?? session.server,
    ...(link.container ? { container: link.container } : {}),
    key: String(link.id),
  };
  return { kind: link.source, ticket, driver, session, ref, linkedFromAddress };
}

/**
 * A ticket displayed as a GitHub issue (#734) keeps only its address, as it
 * always has. That address names the issue, so nothing new is stored.
 */
function carriedLinkOf(ticket) {
  if (!ticket.github || ticket.linkIsIssue === false) return null;
  const ref = matchIssueUrl(github, ticket.github);
  return ref ? { source: github.kind, id: ref.key, container: ref.container } : null;
}

/**
 * A member who can't read a ticket's GitHub address still sees the ticket: it
 * shows as the plain link it is. Only the ticket's own title is shown, which
 * was never the issue's secret to keep the way a carried Redmine subject is.
 * The page says why: no connection (`plain-link-connect`), or the account
 * can't open it (`plain-link`: private, moved, deleted or not approved).
 */
const plainLink = () => new Meteor.Error('plain-link', 'This ticket shows as a plain link for you.');
const notConnectedLink = () =>
  new Meteor.Error('plain-link-connect', 'Connect this source to see the issue behind this link.');

/**
 * Why a ticket's address couldn't be read. A refusal or a missing or moved
 * issue is the account's view of it; an outage or a rate limit says nothing
 * about access, and is said as what it is.
 */
function addressFailure(err, driver) {
  if (err instanceof EngineError || (err?.status >= 300 && err?.status < 500 && !err.rateLimited)) {
    return plainLink();
  }
  return toMeteorError(err, driver);
}

/**
 * Keep the ticket's saved title the issue's (#757): the Tickets list, My Board
 * and search show the saved one, so it follows the source whenever someone who
 * can read the issue does. Matched on the title and link just read, so a
 * rename or a relink that lands meanwhile isn't overwritten. `updatedAt` is
 * left alone: following isn't an edit, and the dashboard dates a closed
 * ticket's closure by it.
 */
async function followTitle(ticket, record) {
  const title = record.title.trim();
  // A ticket displayed by its address keeps the title its team gave it.
  if (!ticket.linkedIssue?.id || !title || title === ticket.title) return;
  await Tickets.updateAsync(
    {
      _id: ticket._id,
      title: ticket.title,
      'linkedIssue.source': ticket.linkedIssue.source,
      'linkedIssue.id': ticket.linkedIssue.id,
    },
    { $set: { title } },
  );
}

function toMeteorError(err, driver) {
  if (err instanceof Meteor.Error) return err;
  if (err instanceof EngineError) return new Meteor.Error(err.code, err.message);
  return driver.toError(err);
}

/** What the engine needs for one issue, from `openOutside`. */
function engineArgs({ driver, session, ref }) {
  return {
    definition: driver.definition,
    hooks: driver.hooks,
    ref,
    request: session.request,
    ctx: session.ctx,
    url: session.urlOf(ref),
  };
}

Meteor.methods({
  /**
   * The issue ticket `ticketId` carries, as a ticket record, read with the
   * caller's own key. `choices.status` is the statuses they may move it to,
   * current first; `me` is their id in the source, to tell their own
   * activity apart. Returns `{ kind, record, choices, me }`.
   */
  async 'tickets.outsideRecord'({ ticketId } = {}) {
    const { userId } = await requireIdentity(this);
    const outside = await openOutside(userId, ticketId);
    enforceRedmineLimit(readLimiter, userId);

    let result;
    let me;
    try {
      [result, me] = await Promise.all([fetchRecord(engineArgs(outside)), outside.session.me()]);
    } catch (err) {
      if (outside.linkedFromAddress) throw addressFailure(err, outside.driver);
      throw toMeteorError(err, outside.driver);
    }
    if (!result && outside.linkedFromAddress) throw plainLink();
    if (!result) {
      throw new Meteor.Error('gone', 'This issue no longer exists, or you can no longer see it.');
    }
    await followTitle(outside.ticket, result.record);
    return { kind: outside.kind, record: result.record, choices: result.choices, me };
  },

  /**
   * Write `edits` (record field → value: `title`, `body`, `status`,
   * `priority`, `assignees`) to the issue ticket `ticketId` carries, as the
   * caller. Only fields the source's definition marks editable, only while
   * the ticket still carries `expectedIssue` (`kind:server:key`, the issue
   * the caller was looking at), and only while its `dates.updated` is still
   * `expectedUpdatedAt`; refused as `stale-link` or `stale` otherwise.
   * Returns `{ record, choices, mismatches }`: `mismatches` names what the
   * source didn't store as sent.
   */
  async 'tickets.writeOutside'({ ticketId, expectedIssue, expectedUpdatedAt, edits } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof expectedIssue !== 'string' || !expectedIssue) {
      throw new Meteor.Error('bad-request', 'expectedIssue is required.');
    }
    if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
      throw new Meteor.Error('bad-request', 'expectedUpdatedAt is required.');
    }
    if (!edits || typeof edits !== 'object' || Array.isArray(edits)) {
      throw new Meteor.Error('bad-request', 'Nothing to change.');
    }
    const outside = await openOutside(userId, ticketId);
    // Relinked since the caller read it: their edit was meant for another issue.
    const { server, container, key } = outside.ref;
    if (`${outside.kind}:${server}:${container ? `${container}#` : ''}${key}` !== expectedIssue) {
      throw new Meteor.Error(
        'stale-link',
        "This ticket's linked issue changed since you opened it. Reload to see the latest version.",
      );
    }
    enforceRedmineLimit(writeLimiter, userId);

    let result;
    try {
      result = await writeRecord({ ...engineArgs(outside), expectedUpdatedAt, edits });
    } catch (err) {
      throw toMeteorError(err, outside.driver);
    }
    await followTitle(outside.ticket, result.record);
    return result;
  },
});
