/**
 * The lock on a linked ticket (#636).
 *
 * While anyone has a timer running on a ticket that is linked to a Redmine
 * issue, the ticket's link and fields cannot be changed: the time being
 * recorded is on its way to that issue, and the ticket must not move under it.
 *
 * Computed on every check and never stored. A timer only counts while the
 * shift it runs in is still open, so a session orphaned by an edited or deleted
 * shift cannot lock a ticket forever. Only the timer's owner releases the lock,
 * by stopping the timer or clocking out.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

import { ClockEvents, Timers, WorkItems, isValidId } from './collections';
import { userDisplayName } from './notify-core';
import { linkedIssueIdOf, lockMessage } from './ticket-link-core';
import { HUDDLE, sourceSelector } from './ticket-refs';

/** The users who have ever opened a work item on a Huddle ticket, keyed by work item id. */
async function workItemOwners(ticketId) {
  const items = await WorkItems.find(
    { ticketId, ...sourceSelector(HUDDLE) },
    { fields: { _id: 1, userId: 1 } },
  ).fetchAsync();
  return new Map(items.map((item) => [item._id.toHexString(), item.userId]));
}

/**
 * The users timing a Huddle ticket right now, inside a shift that is still open.
 * @returns {Promise<Array<{userId: string, name: string}>>}
 */
export async function findLockHolders(ticketId) {
  const owners = await workItemOwners(ticketId);
  if (!owners.size) return [];

  const running = await Timers.find(
    { workItemId: { $in: [...owners.keys()] }, endTime: null },
    { fields: { userId: 1, clockEventId: 1 } },
  ).fetchAsync();
  const shiftIds = running.map((session) => session.clockEventId).filter(isValidId);
  if (!shiftIds.length) return [];

  const openShifts = await ClockEvents.find(
    { _id: { $in: shiftIds.map((id) => new Mongo.ObjectID(id)) }, endTime: null },
    { fields: { _id: 1 } },
  ).fetchAsync();
  const open = new Set(openShifts.map((shift) => shift._id.toHexString()));

  const userIds = [
    ...new Set(running.filter((s) => open.has(s.clockEventId)).map((s) => s.userId)),
  ];
  return Promise.all(userIds.map(async (userId) => ({ userId, name: await userDisplayName(userId) })));
}

/**
 * Throw `ticket-locked` when someone is timing this ticket.
 *
 * Only a linked ticket is locked, so an unlinked one returns at once — except
 * for the act of linking it (`evenIfUnlinked`), which is refused too: the timer
 * already running would otherwise be recording time that belongs to no issue.
 */
export async function assertUnlocked(ticket, callerId, { evenIfUnlinked = false } = {}) {
  if (!evenIfUnlinked && !linkedIssueIdOf(ticket)) return;
  const holders = await findLockHolders(ticket._id.toHexString());
  if (holders.length) throw new Meteor.Error('ticket-locked', lockMessage(holders, callerId));
}

/** Everyone who has logged time on a Huddle ticket (a timer session, running or not). */
export async function usersWithTimeOn(ticketId) {
  const owners = await workItemOwners(ticketId);
  if (!owners.size) return [];
  const sessions = await Timers.find(
    { workItemId: { $in: [...owners.keys()] } },
    { fields: { userId: 1 } },
  ).fetchAsync();
  return [...new Set(sessions.map((session) => session.userId))];
}
