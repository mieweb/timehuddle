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

  const link = ticket.linkedIssue;
  const driver = link?.id ? driverFor(link.source) : null;
  if (!driver) throw new Meteor.Error('not-linked', 'This ticket carries no outside issue.');
  const session = await driver.open(userId);
  if (link.host && link.host !== session.server) {
    throw new Meteor.Error('other-server', 'This issue is on a server your account is not on.');
  }
  const ref = { server: link.host ?? session.server, key: String(link.id) };
  return { kind: link.source, ticket, driver, session, ref };
}

/**
 * Keep the ticket's saved title the issue's (#757): the Tickets list, My Board
 * and search show the saved one, so it follows the source whenever someone who
 * can read the issue does. Matched on the title just read, so a rename that
 * lands meanwhile isn't overwritten.
 */
async function followTitle(ticket, record) {
  const title = record.title.trim();
  if (!title || title === ticket.title) return;
  await Tickets.updateAsync(
    { _id: ticket._id, title: ticket.title },
    { $set: { title, updatedAt: new Date() } },
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
      throw toMeteorError(err, outside.driver);
    }
    if (!result) {
      throw new Meteor.Error('gone', 'This issue no longer exists, or you can no longer see it.');
    }
    await followTitle(outside.ticket, result.record);
    return { kind: outside.kind, record: result.record, choices: result.choices, me };
  },

  /**
   * Write `edits` (record field → value: `title`, `body`, `status`,
   * `priority`, `assignees`) to the issue ticket `ticketId` carries, as the
   * caller. Only fields the source's definition marks editable, and only
   * while the issue's `dates.updated` is still `expectedUpdatedAt`; refused
   * as `stale` otherwise. Returns `{ record, choices, mismatches }`:
   * `mismatches` names what the source didn't store as sent.
   */
  async 'tickets.writeOutside'({ ticketId, expectedUpdatedAt, edits } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) {
      throw new Meteor.Error('bad-request', 'expectedUpdatedAt is required.');
    }
    if (!edits || typeof edits !== 'object' || Array.isArray(edits)) {
      throw new Meteor.Error('bad-request', 'Nothing to change.');
    }
    const outside = await openOutside(userId, ticketId);
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
