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
import { MongoInternals } from 'meteor/mongo';
import { rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { isValidId } from './collections';
import { loadOrgMembers } from './organizations';
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

Meteor.methods({
  /**
   * Usage rows for the members of the organizations the caller administers.
   *
   * `orgId` narrows to one of them; omitting it reports across all of them.
   * Owner/admin only — this reports on other people's activity.
   */
  async 'usage.orgUsage'({ orgId, periodDays, timezone } = {}) {
    const identity = await requireIdentity(this);

    const available = await adminOrganizationsFor(identity.userId);
    if (available.length === 0) {
      throw new Meteor.Error('forbidden', 'Requires organization owner or admin');
    }

    // An orgId the caller does not administer is a permission failure, not an
    // empty report — otherwise probing ids would confirm which ones exist.
    const scoped = orgId ? available.filter((org) => org.id === orgId) : available;
    if (scoped.length === 0) {
      throw new Meteor.Error('forbidden', 'Requires organization owner or admin');
    }

    const period = USAGE_PERIOD_DAYS.includes(periodDays) ? periodDays : DEFAULT_PERIOD_DAYS;
    const zone = isValidTimezone(timezone) ? timezone : 'UTC';

    const rosters = await Promise.all(
      scoped.map(async (organization) => ({
        organization,
        members: await loadOrgMembers(organization.id),
      })),
    );
    const members = mergeOrgMembers(rosters);

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

    const rows = summarizeUsage({
      members,
      buckets,
      startDay: periodStartDay(period, zone),
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
      generatedAt: new Date().toISOString(),
      totals: summarizeTotals(rows),
      users: rows,
    };
  },
});
