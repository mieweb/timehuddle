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

import { ClockEvents, Teams, Timers, WorkItems, isObjectIdHex } from './collections';
import { userDisplayName } from './notify-core';
import { linkedIssueIdOf, lockMessage } from './ticket-link-core';
import { HUDDLE, sourceSelector } from './ticket-refs';

/**
 * The users timing each of these Huddle tickets right now, inside a shift that
 * is still open.
 *
 * Looked up from the running timers of the tickets' team members, never from
 * the tickets' work items: a person has at most one running timer, so the cost
 * follows the size of the team, not the age of the ticket. One pass answers
 * for any number of tickets.
 *
 * @param {Array<{_id: {toHexString(): string}, teamId: string}>} tickets
 * @returns {Promise<Map<string, Array<{userId: string, name: string}>>>}
 *   holders by ticket id; a ticket nobody is timing maps to an empty list
 */
export async function findLockHoldersFor(tickets) {
  const holders = new Map(tickets.map((ticket) => [ticket._id.toHexString(), []]));
  const teamIds = [...new Set(tickets.map((ticket) => ticket.teamId))].filter(isObjectIdHex);
  if (!teamIds.length) return holders;

  const teams = await Teams.find(
    { _id: { $in: teamIds.map((id) => new Mongo.ObjectID(id)) } },
    { fields: { members: 1, admins: 1 } },
  ).fetchAsync();
  const teamUserIds = [
    ...new Set(teams.flatMap((team) => [...(team.members ?? []), ...(team.admins ?? [])])),
  ];
  if (!teamUserIds.length) return holders;

  const running = (
    await Timers.find(
      { userId: { $in: teamUserIds }, endTime: null },
      { fields: { userId: 1, workItemId: 1, clockEventId: 1 } },
    ).fetchAsync()
  ).filter((s) => isObjectIdHex(s.workItemId) && isObjectIdHex(s.clockEventId));
  if (!running.length) return holders;

  const objectIds = (ids) => [...new Set(ids)].map((id) => new Mongo.ObjectID(id));
  const [items, openShifts] = await Promise.all([
    WorkItems.find(
      {
        _id: { $in: objectIds(running.map((s) => s.workItemId)) },
        ticketId: { $in: [...holders.keys()] },
        ...sourceSelector(HUDDLE),
      },
      { fields: { ticketId: 1 } },
    ).fetchAsync(),
    ClockEvents.find(
      { _id: { $in: objectIds(running.map((s) => s.clockEventId)) }, endTime: null },
      { fields: { _id: 1 } },
    ).fetchAsync(),
  ]);
  const ticketByWorkItem = new Map(items.map((item) => [item._id.toHexString(), item.ticketId]));
  const open = new Set(openShifts.map((shift) => shift._id.toHexString()));

  const names = new Map();
  for (const session of running) {
    const ticketId = ticketByWorkItem.get(session.workItemId);
    if (!ticketId || !open.has(session.clockEventId)) continue;
    const held = holders.get(ticketId);
    if (held.some((holder) => holder.userId === session.userId)) continue;
    if (!names.has(session.userId)) names.set(session.userId, await userDisplayName(session.userId));
    held.push({ userId: session.userId, name: names.get(session.userId) });
  }
  return holders;
}

/** The users timing one Huddle ticket right now (see `findLockHoldersFor`). */
export async function findLockHolders(ticket) {
  return (await findLockHoldersFor([ticket])).get(ticket._id.toHexString()) ?? [];
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
  const holders = await findLockHolders(ticket);
  if (holders.length) throw new Meteor.Error('ticket-locked', lockMessage(holders, callerId));
}

/**
 * Everyone who has logged time on a Huddle ticket (a timer session, running or
 * not). Reads the ticket's whole history, so it is for the moment a link is
 * about to change, never for a page that polls.
 */
export async function usersWithTimeOn(ticketId) {
  const items = await WorkItems.find(
    { ticketId, ...sourceSelector(HUDDLE) },
    { fields: { _id: 1 } },
  ).fetchAsync();
  if (!items.length) return [];
  const sessions = await Timers.find(
    { workItemId: { $in: items.map((item) => item._id.toHexString()) } },
    { fields: { userId: 1 } },
  ).fetchAsync();
  return [...new Set(sessions.map((session) => session.userId))];
}
