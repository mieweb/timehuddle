/**
 * Today's plan on the clock session (M4, #886) — its items and their checked
 * state, kept on `clockevents.planItems` apart from the plan's Huddle post
 * (see session-plan-core.js). The Clock page and My Board read it here; every
 * change to it that the team should know about is a new Huddle update, never
 * an edit to the plan post.
 *
 * Ticket timers keep it current through `planTouchAndGo`: starting a ticket
 * unchecks its item, and the ticket switched away from is checked off.
 *
 * A session's plan starts from its plan post the first time it's needed
 * (`ensurePlan`), whichever page or timer gets there first. Every write is
 * checked against the plan's revision and retried (`commitPlan`), so changes
 * made at once — two checks, a check and a switch — all land, and only what
 * was saved is announced.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { requireIdentity } from './auth-bridge';
import { isValidId, rawDb } from './collections';
import { SESSION_POST_FILTER, SESSION_POST_SORT } from './clock-core';
import { requireTeamMembership } from './permissions';
import { normalizeSource } from './ticket-refs';
import {
  MAX_ITEM_TEXT,
  MAX_PLAN_ITEMS,
  mergePlan,
  planInput,
  touchAndGo,
  withChecked,
} from './session-plan-core';
import { PlanUpdate, planUpdateText } from './timer-updates-core';
import { insertUpdatePost, teamTicketLabels } from './timer-updates';
import { ticketName } from './ticket-label';
import { planChecklist } from '@timehuddle/plan-items';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const clockEvents = () => rawDb().collection('clockevents');
const newItemId = () => new ObjectId().toHexString();

/** Attempts at a revision-checked write before giving up on a busy plan. */
const COMMIT_ATTEMPTS = 5;

/**
 * The caller's open session on a team, or a hard stop. Owning an open session
 * isn't enough: someone removed from the team keeps theirs open, and must not
 * read its tickets or post to its Huddle.
 */
async function openSession(userId, teamId) {
  if (typeof teamId !== 'string' || !teamId) {
    throw new Meteor.Error('bad-request', 'teamId is required');
  }
  await requireTeamMembership(userId, teamId);
  const event = await clockEvents().findOne({ userId, teamId, endTime: null });
  if (!event) throw new Meteor.Error('no-active-shift', 'Clock in to plan your day');
  return ensurePlan(event);
}

/**
 * Apply `change` to the plan as stored, and save the result only if no one
 * else saved in between; otherwise read again and redo it. `change` returns
 * `{ items, changed }` (and anything else the caller needs back), and is
 * called with the latest items each time.
 * @returns {Promise<{ event: object, result: object }>} the event as saved and
 *   `change`'s result; nothing saved when `result.changed` is false
 */
async function commitPlan(event, change) {
  let current = event;
  for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
    const result = change(current.planItems ?? []);
    if (!result.changed) return { event: current, result };
    const rev = current.planRev ?? null;
    const saved = await clockEvents().updateOne(
      // `planRev: null` also matches a plan that has never been written.
      { _id: current._id, planRev: rev },
      { $set: { planItems: result.items, planRev: (rev ?? 0) + 1 } },
    );
    if (saved.modifiedCount) {
      return { event: { ...current, planItems: result.items, planRev: (rev ?? 0) + 1 }, result };
    }
    current = await clockEvents().findOne({ _id: current._id });
    if (!current) break;
  }
  throw new Meteor.Error('plan-busy', 'Your plan changed meanwhile. Please try again.');
}

/**
 * A session's plan, started from its plan post the first time it's needed:
 * the post's items, all unchecked, with the team's tickets as tickets (a link
 * to another team's stays text). A session with no plan post stays without a
 * plan until one is set.
 */
async function ensurePlan(event) {
  if (Array.isArray(event.planItems)) return event;
  const post = await rawDb()
    .collection('huddlePosts')
    .findOne(
      {
        teamId: String(event.teamId),
        userId: event.userId,
        clockEventId: event._id.toHexString(),
        status: { $ne: 'draft' },
        ...SESSION_POST_FILTER,
      },
      { sort: SESSION_POST_SORT, projection: { 'content.text': 1 } },
    );
  const text = post?.content?.text;
  if (typeof text !== 'string') return event;
  const ours = await teamTickets(event.teamId, planChecklist(text).flatMap(ticketIdOf));
  const input = planInput(planChecklist(text, (id) => ours.has(id)));
  // Nothing is saved, so once the post is shortened the plan starts from it.
  if (!input) {
    throw new Meteor.Error(
      'plan-too-long',
      `Today's plan has more than ${MAX_PLAN_ITEMS} items, or an item over ${MAX_ITEM_TEXT} characters. Shorten your plan post to use it here.`,
    );
  }
  const { items } = mergePlan([], input, newItemId);
  // Only if no one else started it meanwhile; either way, read what's there.
  await clockEvents().updateOne(
    { _id: event._id, planItems: { $exists: false } },
    { $set: { planItems: items, planRev: 1 } },
  );
  return (await clockEvents().findOne({ _id: event._id })) ?? event;
}

const ticketIdOf = (item) => (item.ticketId ? [item.ticketId] : []);

/**
 * Each ticket's time in a session: its closed stints' seconds, and when the
 * one running started: `Map<ticketId, { closedSeconds, runningSince }>`.
 */
async function ticketTimes(userId, clockEventId) {
  const sessions = await rawDb().collection('timers').find({ userId, clockEventId }).toArray();
  const workItemIds = [...new Set(sessions.map((s) => s.workItemId))].filter(isValidId);
  if (!workItemIds.length) return new Map();
  const items = await rawDb()
    .collection('workitems')
    .find(
      { _id: { $in: workItemIds.map((id) => new ObjectId(id)) } },
      { projection: { source: 1, ticketId: 1 } },
    )
    .toArray();
  const ticketOf = new Map(
    items
      .filter((item) => normalizeSource(item.source) === 'huddle')
      .map((item) => [item._id.toHexString(), item.ticketId]),
  );
  const times = new Map();
  for (const session of sessions) {
    const ticketId = ticketOf.get(session.workItemId);
    if (!ticketId) continue;
    const time = times.get(ticketId) ?? { closedSeconds: 0, runningSince: null };
    if (session.endTime === null) time.runningSince = session.startTime;
    else time.closedSeconds += session.durationSeconds ?? 0;
    times.set(ticketId, time);
  }
  return times;
}

/** A ticket's whole time in a session, the running stint up to `now` included. */
function totalSeconds(time, now = Date.now()) {
  if (!time) return 0;
  const running = time.runningSince === null ? 0 : Math.floor((now - time.runningSince) / 1000);
  return time.closedSeconds + Math.max(0, running);
}

/** A Huddle ticket's id from a work item, or null (a Redmine issue, a gone item). */
async function huddleTicketOf(workItemId) {
  if (!isValidId(workItemId)) return null;
  const item = await rawDb()
    .collection('workitems')
    .findOne({ _id: new ObjectId(workItemId) }, { projection: { source: 1, ticketId: 1 } });
  return item && normalizeSource(item.source) === 'huddle' ? item.ticketId : null;
}

/**
 * The plan as the client shows it: each item with what it's called now, and
 * for a ticket its closed stints' seconds this session and when its running
 * one started, so the client can keep the time live. A ticket since deleted
 * is left out.
 * `initialized` is false until the session has had a plan set.
 */
async function publicPlan(event) {
  const stored = Array.isArray(event.planItems) ? event.planItems : [];
  const ticketIds = stored.flatMap((item) => (item.ticketId ? [item.ticketId] : []));
  const [labels, times] = await Promise.all([
    teamTicketLabels(event.teamId, ticketIds),
    ticketIds.length ? ticketTimes(event.userId, event._id.toHexString()) : new Map(),
  ]);
  const items = stored.flatMap((item) => {
    if (!item.ticketId) return [{ id: item.id, text: item.text, checked: item.checked }];
    const label = labels.get(item.ticketId);
    if (!label) return [];
    const time = times.get(item.ticketId);
    return [
      {
        id: item.id,
        ticketId: item.ticketId,
        title: ticketName(label),
        checked: item.checked,
        seconds: time?.closedSeconds ?? 0,
        runningSince: time?.runningSince ?? null,
      },
    ];
  });
  return {
    clockEventId: event._id.toHexString(),
    initialized: Array.isArray(event.planItems),
    items,
  };
}

/** Post one plan update per item, in order, a millisecond apart so they read that way. */
async function postPlanUpdates(event, kind, items) {
  if (!items.length) return;
  const ticketIds = items.flatMap((item) => (item.ticketId ? [item.ticketId] : []));
  const [labels, times] = await Promise.all([
    teamTicketLabels(event.teamId, ticketIds),
    kind === PlanUpdate.CHECKED && ticketIds.length
      ? ticketTimes(event.userId, event._id.toHexString())
      : new Map(),
  ]);
  const start = Date.now();
  for (const [i, item] of items.entries()) {
    const label = item.ticketId ? labels.get(item.ticketId) : null;
    if (item.ticketId && !label) continue;
    const seconds =
      item.ticketId && kind === PlanUpdate.CHECKED ? totalSeconds(times.get(item.ticketId)) : null;
    await insertUpdatePost({
      teamId: event.teamId,
      userId: event.userId,
      text: planUpdateText(kind, label ? { label } : { text: item.text }, seconds),
      at: start + i,
    });
  }
}

/**
 * Touch and go, for a ticket timer that just started inside a session (called
 * by `timers.js`): the started ticket's item is unchecked, and the one it
 * switched from is checked off. `discardPrevious` is a slip whose update is
 * being thrown away, so it isn't checked off either.
 *
 * Best-effort, like the updates: a timer starts whatever happens here.
 * @returns {Promise<{ teamId: string, ticketId: string, seconds: number } | null>}
 *   the ticket checked off, with its time this session and the plan's team,
 *   for the switch's update to name
 */
export async function planTouchAndGo(userId, previous, session, { discardPrevious = false } = {}) {
  try {
    if (!isValidId(session?.clockEventId)) return null;
    const open = await clockEvents().findOne({
      _id: new ObjectId(session.clockEventId),
      userId,
      endTime: null,
    });
    if (!open) return null;
    const event = await ensurePlan(open);
    if (!Array.isArray(event.planItems) || !event.planItems.length) return null;
    const [fromTicketId, toTicketId] = await Promise.all([
      previous && !discardPrevious ? huddleTicketOf(previous.workItemId) : null,
      huddleTicketOf(session.workItemId),
    ]);
    const { result } = await commitPlan(event, (items) =>
      touchAndGo(items, { fromTicketId, toTicketId }),
    );
    const { checkedOff } = result;
    if (!result.changed || !checkedOff) return null;
    const times = await ticketTimes(userId, session.clockEventId);
    return {
      teamId: String(event.teamId),
      ticketId: checkedOff.ticketId,
      seconds: totalSeconds(times.get(checkedOff.ticketId)),
    };
  } catch (err) {
    console.error('[session-plan] touch and go failed:', err);
    return null;
  }
}

/** The team's tickets among `ticketIds`: a link to any other stays text, as in the post. */
async function teamTickets(teamId, ticketIds) {
  return new Set((await teamTicketLabels(teamId, ticketIds)).keys());
}

/** One update per item whose check an edit changed, checked ones first. */
async function postToggles(event, toggled) {
  await postPlanUpdates(event, PlanUpdate.CHECKED, toggled.filter((item) => item.checked));
  await postPlanUpdates(event, PlanUpdate.UNCHECKED, toggled.filter((item) => !item.checked));
}

Meteor.methods({
  /** Today's plan on the caller's open session in a team, or null when clocked out there. */
  async 'clock.plan'({ teamId } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof teamId !== 'string' || !teamId) return null;
    await requireTeamMembership(userId, teamId);
    const event = await clockEvents().findOne({ userId, teamId, endTime: null });
    return event ? publicPlan(await ensurePlan(event)) : null;
  },

  /**
   * Set today's plan from its items in order (`{ ticketId }` or `{ text,
   * checked? }`). Items already in it keep whether they're checked off unless
   * the edit says otherwise. Each new item is announced ("Added TH-307 to
   * today's plan"), and so is each check the edit changed.
   */
  async 'clock.setPlan'({ teamId, items } = {}) {
    const { userId } = await requireIdentity(this);
    const event = await openSession(userId, teamId);
    const input = planInput(items);
    if (!input) throw new Meteor.Error('bad-request', 'Not a plan');
    const ours = await teamTickets(teamId, input.flatMap(ticketIdOf));
    const kept = input.filter((item) => !item.ticketId || ours.has(item.ticketId));
    const saved = await commitPlan(event, (current) => ({
      ...mergePlan(current, kept, newItemId),
      changed: true,
    }));
    await postPlanUpdates(saved.event, PlanUpdate.ADDED, saved.result.added);
    await postToggles(saved.event, saved.result.toggled);
    return publicPlan(saved.event);
  },

  /** Check an item off by hand, or uncheck it; either is announced. */
  async 'clock.checkPlanItem'({ teamId, itemId, checked } = {}) {
    const { userId } = await requireIdentity(this);
    if (typeof itemId !== 'string' || typeof checked !== 'boolean') {
      throw new Meteor.Error('bad-request', 'itemId and checked are required');
    }
    const event = await openSession(userId, teamId);
    const saved = await commitPlan(event, (items) => withChecked(items, itemId, checked));
    const { changed } = saved.result;
    if (changed) {
      await postPlanUpdates(saved.event, checked ? PlanUpdate.CHECKED : PlanUpdate.UNCHECKED, [changed]);
    }
    return publicPlan(saved.event);
  },
});
