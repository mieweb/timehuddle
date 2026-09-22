/**
 * Org usage analytics — the parts that are just arithmetic.
 *
 * Deliberately free of Meteor and Mongo imports so the cadence rules and the
 * per-member roll-up can be unit tested without a running server (see
 * tests/usage-core.test.ts). Everything that touches the database lives in
 * usage.js.
 */

/** Days of history the cadence classification always reads, whatever period the page is showing. */
export const CADENCE_WINDOW_DAYS = 30;

/** Periods the usage page can scope its counts to. */
export const USAGE_PERIOD_DAYS = [1, 7, 14, 30];

export const DEFAULT_PERIOD_DAYS = 7;

/**
 * Every collection a tracked TimeHuddle action lands in, and how to read a
 * user and a timestamp out of it.
 *
 * `timeType: 'ms'` marks the epoch-millisecond fields — clockevents.startTime
 * is a number, not a Date — so the range filter can compare against the same
 * BSON type the documents actually store and still use an index.
 */
export const FEATURE_SOURCES = [
  {
    key: 'clock',
    label: 'Clock',
    collection: 'clockevents',
    userField: 'userId',
    timeField: 'startTime',
    timeType: 'ms',
  },
  {
    key: 'posts',
    label: 'Huddle posts',
    collection: 'huddlePosts',
    userField: 'userId',
    timeField: 'createdAt',
    timeType: 'date',
  },
  {
    key: 'comments',
    label: 'Comments',
    collection: 'huddleComments',
    userField: 'userId',
    timeField: 'createdAt',
    timeType: 'date',
  },
  {
    key: 'tickets',
    label: 'Tickets',
    collection: 'tickets',
    userField: 'createdBy',
    timeField: 'createdAt',
    timeType: 'date',
  },
  {
    key: 'timers',
    label: 'Work timers',
    collection: 'timers',
    userField: 'userId',
    timeField: 'createdAt',
    timeType: 'date',
  },
  {
    key: 'pulse',
    label: 'Pulse videos',
    collection: 'mediaitems',
    userField: 'userId',
    timeField: 'uploadedAt',
    timeType: 'date',
  },
];

export const FEATURE_KEYS = FEATURE_SOURCES.map((source) => source.key);

/**
 * How often a member turns up, read off the number of distinct days they did
 * anything in the last CADENCE_WINDOW_DAYS.
 *
 * The thresholds are days-per-30, chosen so that someone who works weekdays
 * and takes a week off is still 'daily' (~16 days), while a once-a-week user
 * (~4 days) is not. First rule whose floor is met wins.
 */
const CADENCE_RULES = [
  { cadence: 'daily', minActiveDays: 15 },
  { cadence: 'weekly', minActiveDays: 4 },
  { cadence: 'biweekly', minActiveDays: 2 },
  { cadence: 'monthly', minActiveDays: 1 },
];

/** 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'dormant' */
export function classifyCadence(activeDays) {
  const rule = CADENCE_RULES.find((candidate) => activeDays >= candidate.minActiveDays);
  return rule ? rule.cadence : 'dormant';
}

/** The day, as YYYY-MM-DD in `timezone`, that `date` falls on. */
export function toDayKey(date, timezone) {
  // en-CA formats as YYYY-MM-DD, which is both what $dateToString emits and
  // lexicographically sortable — so day keys compare as plain strings.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

/** The first day included in a period of `periodDays` ending today. */
export function periodStartDay(periodDays, timezone, now = new Date()) {
  const start = new Date(now.getTime() - (periodDays - 1) * 24 * 60 * 60 * 1000);
  return toDayKey(start, timezone);
}

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

/** The more powerful of two organization roles. */
export function higherRole(a, b) {
  if (!a) return b;
  if (!b) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * Union per-organization rosters into one member list.
 *
 * Someone who belongs to two of the organizations in scope appears once,
 * carrying both names and the higher of their two roles. They count as blocked
 * when they are blocked in any organization in scope — the report is about
 * whether this person is using TimeHuddle, and a block anywhere in the reader's
 * remit is the part worth surfacing.
 *
 * @param {{organization: UsageOrganization, members: object[]}[]} rosters
 * @returns {UsageMember[]}
 */
export function mergeOrgMembers(rosters) {
  const scopedOrgIds = new Set(rosters.map((roster) => roster.organization.id));
  const byId = new Map();

  for (const { organization, members } of rosters) {
    for (const member of members) {
      const blocked = (member.blocked ?? []).some((entry) => scopedOrgIds.has(entry.orgId));
      const existing = byId.get(member.id);

      if (existing) {
        existing.organizations.push(organization);
        existing.role = higherRole(existing.role, member.role);
        existing.blocked = existing.blocked || blocked;
        continue;
      }

      byId.set(member.id, {
        id: member.id,
        name: member.name,
        email: member.email,
        username: member.username ?? null,
        image: member.image ?? null,
        role: member.role,
        blocked,
        organizations: [organization],
      });
    }
  }

  return [...byId.values()];
}

function emptyFeatureCounts() {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, 0]));
}

/** The feature with the most actions, ties broken by FEATURE_SOURCES order. */
function pickTopFeature(featureCounts) {
  let top = null;
  for (const key of FEATURE_KEYS) {
    if (featureCounts[key] > 0 && (top === null || featureCounts[key] > featureCounts[top])) {
      top = key;
    }
  }
  return top;
}

/**
 * @typedef {object} UsageOrganization
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {object} UsageMember
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string|null} username
 * @property {string|null} image
 * @property {string} role - the highest role they hold across `organizations`
 * @property {boolean} blocked - blocked in any organization in scope
 * @property {UsageOrganization[]} organizations - those in scope they belong to
 */

/**
 * One source's action count for one member on one day.
 *
 * @typedef {object} UsageBucket
 * @property {string} feature - a FEATURE_SOURCES key
 * @property {string} userId
 * @property {string} day     - YYYY-MM-DD in the report's timezone
 * @property {number} count
 * @property {string|null} lastAt - ISO timestamp of the latest action that day
 */

/**
 * Fold per-user/per-day/per-feature buckets into one row per member.
 *
 * Buckets cover the full cadence window; `startDay` selects the narrower
 * period the counts are for, while cadence always reads every bucket. A member
 * with no buckets at all still gets a row — a member who has stopped using
 * TimeHuddle is the whole point of the page.
 *
 * @param {object} options
 * @param {UsageMember[]} options.members
 * @param {UsageBucket[]} options.buckets
 * @param {string} options.startDay - first day of the selected period (YYYY-MM-DD)
 */
export function summarizeUsage({ members, buckets, startDay }) {
  const byUser = new Map(
    members.map((member) => [
      member.id,
      {
        member,
        features: emptyFeatureCounts(),
        totalActions: 0,
        periodDays: new Set(),
        windowDays: new Set(),
        lastActiveAt: null,
      },
    ]),
  );

  for (const bucket of buckets) {
    const entry = byUser.get(bucket.userId);
    // A bucket for someone outside the member list (a deleted user, say) is
    // not an error — there is simply no row to add it to.
    if (!entry) continue;

    entry.windowDays.add(bucket.day);
    if (bucket.lastAt && (entry.lastActiveAt === null || bucket.lastAt > entry.lastActiveAt)) {
      entry.lastActiveAt = bucket.lastAt;
    }
    if (bucket.day < startDay) continue;

    entry.features[bucket.feature] += bucket.count;
    entry.totalActions += bucket.count;
    entry.periodDays.add(bucket.day);
  }

  return [...byUser.values()]
    .map(({ member, features, totalActions, periodDays, windowDays, lastActiveAt }) => {
      const cadenceActiveDays = windowDays.size;
      return {
        ...member,
        status: member.blocked ? 'blocked' : totalActions > 0 ? 'active' : 'idle',
        features,
        totalActions,
        activeDays: periodDays.size,
        cadence: classifyCadence(cadenceActiveDays),
        cadenceActiveDays,
        topFeature: pickTopFeature(features),
        lastActiveAt,
      };
    })
    .sort(
      (a, b) =>
        b.totalActions - a.totalActions ||
        b.cadenceActiveDays - a.cadenceActiveDays ||
        a.name.localeCompare(b.name),
    );
}

/** Headline counts for the cards above the grid. */
export function summarizeTotals(rows) {
  const cadenceCounts = { daily: 0, weekly: 0, biweekly: 0, monthly: 0, dormant: 0 };
  const featureTotals = emptyFeatureCounts();
  let activeMembers = 0;

  for (const row of rows) {
    cadenceCounts[row.cadence] += 1;
    if (row.totalActions > 0) activeMembers += 1;
    for (const key of FEATURE_KEYS) featureTotals[key] += row.features[key];
  }

  return {
    members: rows.length,
    activeMembers,
    cadenceCounts,
    featureTotals,
    topFeature: pickTopFeature(featureTotals),
  };
}
