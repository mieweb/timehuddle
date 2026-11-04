/**
 * Org usage report — who is actually using TimeHuddle, and for what.
 *
 * One method, `usage.orgUsage`, scoped to the organizations the caller owns or
 * administers. Passing an `orgId` narrows it to that one; omitting it reports
 * across all of them at once. It answers two different questions:
 *
 *   • counts for the period the viewer picked (today / 7 / 14 / 30 days), and
 *   • a cadence label — daily, weekly, biweekly, monthly, dormant — which
 *     always reads the full 30-day window so switching the period never
 *     changes how habitual someone looks.
 *
 * Both come out of one pass: every source is aggregated once over the wider of
 * the two windows into per-user/per-day buckets, and usage-core folds those
 * into rows. The arithmetic lives there; this file is the Mongo half.
 *
 * Note on scope: the organization selection decides **which members are
 * listed**, not which of their actions count. A member's totals are their whole
 * TimeHuddle activity, because three of the six sources (Pulse uploads, work
 * timers, comments) carry no team and so cannot be attributed to an
 * organization. Counting the other three per-org and these three globally would
 * be a column that means two different things, so the report keeps one honest
 * meaning: how much this person uses TimeHuddle.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';
import { ClockEvents, HuddlePosts, Tickets, Timers, rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { isValidId } from './collections';
import { loadOrgMembers } from './organizations';
import { isOnline, onPresenceChange } from './presence';
import {
  CADENCE_WINDOW_DAYS,
  DEFAULT_PERIOD_DAYS,
  FEATURE_SOURCES,
  USAGE_PERIOD_DAYS,
  mergeOrgMembers,
  periodStartDay,
  summarizeTotals,
  summarizeUsage,
} from './usage-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const ELEVATED_ROLES = ['owner', 'admin'];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every organization `userId` owns or administers, newest role model first
 * (org_members) plus the legacy owners/admins arrays the older orgs still use.
 */
async function adminOrganizationsFor(userId) {
  const db = rawDb();

  const memberships = await db
    .collection('org_members')
    .find({ userId, role: { $in: ELEVATED_ROLES } }, { projection: { orgId: 1 } })
    .toArray();

  const legacy = await db
    .collection('organizations')
    .find({ $or: [{ owners: userId }, { admins: userId }] }, { projection: { _id: 1 } })
    .toArray();

  const ids = [
    ...new Set([
      ...memberships.map((membership) => membership.orgId).filter(isValidId),
      ...legacy.map((org) => org._id.toHexString()),
    ]),
  ];
  if (ids.length === 0) return [];

  const orgs = await db
    .collection('organizations')
    .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } }, { projection: { name: 1 } })
    .toArray();

  return orgs
    .map((org) => ({ id: org._id.toHexString(), name: org.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Per-user, per-day action counts for one source, over `[windowStart, now]`.
 *
 * `$toDate` normalises the epoch-millisecond fields and the Date fields to the
 * same type before bucketing, but the `$match` bound stays in the field's own
 * type so the range can still be served from an index.
 */
async function bucketsForSource(source, memberIds, windowStart, timezone) {
  const lowerBound = source.timeType === 'ms' ? windowStart.getTime() : windowStart;
  const timeRef = `$${source.timeField}`;

  const docs = await rawDb()
    .collection(source.collection)
    .aggregate([
      { $match: { [source.userField]: { $in: memberIds }, [source.timeField]: { $gte: lowerBound } } },
      {
        $group: {
          _id: {
            userId: `$${source.userField}`,
            day: { $dateToString: { date: { $toDate: timeRef }, format: '%Y-%m-%d', timezone } },
          },
          count: { $sum: 1 },
          lastAt: { $max: { $toDate: timeRef } },
        },
      },
    ])
    .toArray();

  return docs.map((doc) => ({
    feature: source.key,
    userId: doc._id.userId,
    day: doc._id.day,
    count: doc.count,
    lastAt: doc.lastAt instanceof Date ? doc.lastAt.toISOString() : null,
  }));
}

/**
 * When each member's still-open clock session began, keyed by userId.
 *
 * Someone clocked in since before the period started has no clock event inside
 * it, yet is plainly working; this is what lets the report say so. A member
 * clocked in on several teams gets their earliest open session.
 */
async function openClockSessions(memberIds) {
  const events = await rawDb()
    .collection('clockevents')
    .find({ userId: { $in: memberIds }, endTime: null }, { projection: { userId: 1, startTime: 1 } })
    .toArray();

  const since = new Map();
  for (const event of events) {
    const startedAt = new Date(event.startTime).toISOString();
    const existing = since.get(event.userId);
    if (!existing || startedAt < existing) since.set(event.userId, startedAt);
  }
  return since;
}

/**
 * The organizations `userId` may report on, and those this report covers:
 * `orgId`, or all of them when it is omitted. Owner/admin only.
 */
async function reportScope(userId, orgId) {
  const available = await adminOrganizationsFor(userId);
  // An orgId the caller does not administer is a permission failure, not an
  // empty report — otherwise probing ids would confirm which ones exist.
  const scoped = orgId ? available.filter((org) => org.id === orgId) : available;
  if (scoped.length === 0) {
    throw new Meteor.Error('forbidden', 'Requires organization owner or admin');
  }
  return { available, scoped };
}

/** Everyone in the scoped organizations, merged into one list. */
async function membersOf(scoped) {
  const rosters = await Promise.all(
    scoped.map(async (organization) => ({
      organization,
      members: await loadOrgMembers(organization.id),
    })),
  );
  return mergeOrgMembers(rosters);
}

// Each source is read as `userField in members, timeField since the window start`.
Meteor.startup(async () => {
  for (const source of FEATURE_SOURCES) {
    try {
      await rawDb()
        .collection(source.collection)
        .createIndex({ [source.userField]: 1, [source.timeField]: -1 });
    } catch (error) {
      console.error(`[usage] failed to create ${source.collection} index:`, error);
    }
  }
});

Meteor.methods({
  /**
   * Usage rows for the members of the organizations the caller administers.
   *
   * `orgId` narrows to one of them; omitting it reports across all of them.
   * Owner/admin only — this reports on other people's activity.
   */
  async 'usage.orgUsage'({ orgId, periodDays, timezone } = {}) {
    const identity = await requireIdentity(this);
    const { available, scoped } = await reportScope(identity.userId, orgId);

    const period = USAGE_PERIOD_DAYS.includes(periodDays) ? periodDays : DEFAULT_PERIOD_DAYS;
    const zone = isValidTimezone(timezone) ? timezone : 'UTC';

    const members = await membersOf(scoped);

    const memberIds = members.map((member) => member.id);
    // Cadence always reads 30 days; a longer period widens the window to match.
    const windowDays = Math.max(period, CADENCE_WINDOW_DAYS);
    const windowStart = new Date(Date.now() - (windowDays - 1) * DAY_MS);

    const buckets =
      memberIds.length === 0
        ? []
        : (
            await Promise.all(
              FEATURE_SOURCES.map((source) =>
                bucketsForSource(source, memberIds, windowStart, zone).catch((error) => {
                  // One missing or unreadable collection should cost that
                  // feature's column, not the whole report.
                  console.error(`[usage] ${source.collection} aggregation failed:`, error);
                  return [];
                }),
              ),
            )
          ).flat();

    const clockedInSince =
      memberIds.length === 0
        ? new Map()
        : await openClockSessions(memberIds).catch((error) => {
            console.error('[usage] open clock session lookup failed:', error);
            return new Map();
          });
    // Presence is held in memory per server process — one instance per app
    // today. Several instances would need it moved to Mongo (see presence.js).
    const onlineIds = new Set(memberIds.filter((id) => isOnline(id)));
    const generatedAt = new Date().toISOString();

    const rows = summarizeUsage({
      members,
      buckets,
      startDay: periodStartDay(period, zone),
      live: { onlineIds, clockedInSince, now: generatedAt },
    });

    return {
      // Every organization the caller may report on, so the page can offer the
      // picker without a second round trip, plus which of them this report is.
      availableOrganizations: available,
      organizations: scoped,
      orgId: orgId ?? null,
      periodDays: period,
      cadenceWindowDays: CADENCE_WINDOW_DAYS,
      timezone: zone,
      generatedAt,
      totals: summarizeTotals(rows),
      users: rows,
    };
  },
});

// ─── Live updates ─────────────────────────────────────────────────────────────
//
// The report itself stays a method: it is a set of aggregations, not documents
// a cursor can follow. What this publication adds is a signal — one document in
// the client-only `usageLive` collection whose `changedAt` moves whenever
// something the report shows changes for a member in scope:
//
//   • they come online or go offline (presence.js),
//   • they clock in or out (open clockevents),
//   • they do something one of FEATURE_SOURCES counts.
//
// The page refetches `usage.orgUsage` on that signal, so the numbers are always
// computed in one place and still reach the page without a reload.

const LIVE_COLLECTION = 'usageLive';
const SIGNAL_ID = 'signal';

/**
 * A cursor-capable handle per FEATURE_SOURCES collection. Two of them are only
 * ever touched through the raw driver, so they get a read-only Meteor handle
 * here — no mutation methods, purely so their new documents can be observed.
 */
const OBSERVABLE_SOURCES = {
  clockevents: ClockEvents,
  huddlePosts: HuddlePosts,
  tickets: Tickets,
  timers: Timers,
  huddleComments: new Mongo.Collection('huddleComments', { defineMutationMethods: false }),
  mediaitems: new Mongo.Collection('mediaitems', { defineMutationMethods: false }),
};

Meteor.publish('usage.live', async function ({ orgId } = {}) {
  if (!this.userId) return this.ready();

  let members;
  try {
    members = await membersOf((await reportScope(this.userId, orgId)).scoped);
  } catch {
    return this.ready();
  }
  const memberIds = members.map((member) => member.id);
  const memberSet = new Set(memberIds);

  // Observers replay every existing document as `added` before they return;
  // those are the state the report already shows, not changes to it.
  let initializing = true;
  const signal = () => {
    if (!initializing) this.changed(LIVE_COLLECTION, SIGNAL_ID, { changedAt: Date.now() });
  };

  const handles = [];
  const stopAll = () => handles.forEach((handle) => handle.stop());
  this.onStop(stopAll);

  handles.push({ stop: onPresenceChange((userId) => memberSet.has(userId) && signal()) });

  if (memberIds.length > 0) {
    const onEvent = { added: signal, removed: signal };
    handles.push(
      await ClockEvents.find(
        { userId: { $in: memberIds }, endTime: null },
        { fields: { _id: 1 } },
      ).observeChangesAsync(onEvent),
    );

    const now = new Date();
    for (const source of FEATURE_SOURCES) {
      const since = source.timeType === 'ms' ? now.getTime() : now;
      handles.push(
        await OBSERVABLE_SOURCES[source.collection]
          .find(
            { [source.userField]: { $in: memberIds }, [source.timeField]: { $gte: since } },
            { fields: { _id: 1 } },
          )
          .observeChangesAsync({ added: signal }),
      );
    }
  }

  initializing = false;
  this.added(LIVE_COLLECTION, SIGNAL_ID, { changedAt: Date.now() });
  this.ready();
});
