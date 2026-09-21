/**
 * Org usage report — who is actually using TimeHuddle, and for what.
 *
 * One method, `usage.orgUsage`, behind the same default-org owner/admin gate
 * the Members admin page uses. It answers two different questions at once:
 *
 *   • counts for the period the viewer picked (today / 7 / 14 / 30 days), and
 *   • a cadence label — daily, weekly, biweekly, monthly, dormant — which
 *     always reads the full 30-day window so switching the period never
 *     changes how habitual someone looks.
 *
 * Both come out of one pass: every source is aggregated once over the wider of
 * the two windows into per-user/per-day buckets, and usage-core folds those
 * into rows. The arithmetic lives there; this file is the Mongo half.
 */
import { Meteor } from 'meteor/meteor';
import { rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { requireDefaultOrgAdmin, resolveDefaultOrgRole } from './organizations';
import {
  CADENCE_WINDOW_DAYS,
  DEFAULT_PERIOD_DAYS,
  FEATURE_SOURCES,
  USAGE_PERIOD_DAYS,
  periodStartDay,
  summarizeTotals,
  summarizeUsage,
} from './usage-core';

/** Matches `orgs.adminListUsers`, so both admin pages show the same roster. */
const MEMBER_LIMIT = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

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
   * Usage rows for every member of the default organization.
   * Owner/admin only — this reports on other people's activity.
   */
  async 'usage.orgUsage'({ periodDays, timezone } = {}) {
    const identity = await requireIdentity(this);
    const organization = await requireDefaultOrgAdmin(identity.userId);

    const period = USAGE_PERIOD_DAYS.includes(periodDays) ? periodDays : DEFAULT_PERIOD_DAYS;
    const zone = isValidTimezone(timezone) ? timezone : 'UTC';

    const db = rawDb();
    const owners = organization.owners ?? [];
    const admins = organization.admins ?? [];
    const orgId = organization._id.toHexString();

    const userDocs = await db
      .collection('users')
      .find({}, { projection: { profile: 1, emails: 1, username: 1, image: 1, blocked: 1 } })
      .sort({ 'profile.name': 1 })
      .limit(MEMBER_LIMIT)
      .toArray();

    const members = userDocs.map((doc) => {
      const id = String(doc._id);
      return {
        id,
        name: doc.profile?.name ?? doc.username ?? 'Unknown',
        email: doc.emails?.[0]?.address ?? '',
        username: doc.username ?? null,
        image: doc.image ?? null,
        role: resolveDefaultOrgRole(owners, admins, id),
        blocked: (doc.blocked ?? []).some((entry) => entry.orgId === orgId),
      };
    });

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
      organization: { id: orgId, name: organization.name },
      periodDays: period,
      cadenceWindowDays: CADENCE_WINDOW_DAYS,
      timezone: zone,
      generatedAt: new Date().toISOString(),
      totals: summarizeTotals(rows),
      users: rows,
    };
  },
});
