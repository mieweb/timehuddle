/**
 * What a user's notification preferences mean (#784): for one notification,
 * whether it is logged in the bell inbox and which devices it pops up on.
 *
 * Pure — no Meteor or Mongo — so every rule is unit-tested on its own
 * (tests/notification-prefs-core.test.ts). The Mongo half is
 * notification-prefs.js; the one caller is createNotification in notify-core.js.
 *
 * The rules (docs/notification-preferences-784-plan.md, "The Rules"):
 *   - Desktop means web push subscriptions; Phone means native device tokens.
 *   - The bell inbox is a log: a notification is logged when at least one
 *     device is on for its event. Both off means the event is off entirely.
 *   - A type with no event below is not configurable and keeps the old
 *     behaviour: inbox plus every device.
 *   - An absent preference means the event's default, so a user who never
 *     opens the settings gets what they got before — every event that existed
 *     before #784 defaults to both devices.
 *   - Huddle events also pass the user's level for the post's team: `mute`
 *     drops them all, `mentions` (the default) drops new-post alerts.
 *   - An actionable event (the shift-end reminder) stays in the inbox even with
 *     both devices off, so it can still be answered.
 *   - Quiet time holds the push but keeps the inbox row: a snooze holds every
 *     push, "hold while clocked out" holds Huddle pushes except mentions, and
 *     "skip while viewing" holds Huddle pushes for a team whose Huddle the
 *     user has open.
 *   - Some events follow a team setting from the settings hierarchy
 *     (ORG_SETTING_FOR_EVENT): off drops the event for everyone; locked means
 *     the event's defaults apply whatever the person chose.
 */

/** Delivery to the inbox and every device — the behaviour before #784. */
export const DELIVER_EVERYWHERE = Object.freeze({ inbox: true, desktop: true, phone: true });
/** No inbox row and no push. */
export const DELIVER_NOWHERE = Object.freeze({ inbox: false, desktop: false, phone: false });

/**
 * Every configurable event: the notification types it covers and its default
 * per device. Order is the order the Settings page lists them in.
 */
export const EVENTS = Object.freeze({
  huddleMention: {
    types: ['huddle-mention', 'huddle-comment-mention'],
    desktop: true,
    phone: true,
  },
  huddleReply: { types: ['huddle-comment'], desktop: true, phone: true },
  huddlePost: { types: ['huddle-post'], desktop: true, phone: false },
  huddleGroupMention: { types: ['huddle-group-mention'], desktop: true, phone: false },
  ticketAssigned: { types: ['ticket-assigned'], desktop: true, phone: true },
  ticketLink: { types: ['ticket-link-changed'], desktop: true, phone: true },
  shiftEnd: { types: ['shift-end-reminder'], desktop: true, phone: true },
  timesheetRequest: { types: ['timesheet-change-request'], desktop: true, phone: true },
  teamClock: {
    types: ['clock-in', 'clock-out', 'clock-session-changed'],
    desktop: true,
    phone: true,
  },
  joinRequest: { types: ['team-join-request'], desktop: true, phone: true },
});

export const EVENT_KEYS = Object.keys(EVENTS);
export const DEVICES = ['desktop', 'phone'];

/** How much of one team's Huddle reaches a user. */
export const TEAM_LEVELS = ['all', 'mentions', 'mute'];
export const DEFAULT_TEAM_LEVEL = 'mentions';

/** The Huddle events each team level drops; the rest go on to the event setting. */
const DROPPED_BY_LEVEL = {
  all: new Set(),
  mentions: new Set(['huddlePost']),
  mute: new Set(['huddleMention', 'huddleReply', 'huddlePost', 'huddleGroupMention']),
};

/**
 * Events that ask for an answer: the shift-end reminder is how someone keeps
 * working past 8 hours instead of being clocked out. Turning off its pop-ups
 * never drops it from the inbox; only an organization turning it off does.
 */
const ACTIONABLE_EVENTS = new Set(['shiftEnd']);

/** The Huddle events, which "hold while clocked out" applies to. */
const HUDDLE_EVENTS = DROPPED_BY_LEVEL.mute;

/** Team ids are Mongo hex or legacy Meteor ids: safe to use in a dotted path. */
const TEAM_ID_PATTERN = /^[A-Za-z0-9]{7,32}$/;

/** Events an org (or enterprise, or team) controls, by settings/registry.js key. */
export const ORG_SETTING_FOR_EVENT = Object.freeze({
  teamClock: 'notifyAdminsOnClock',
  shiftEnd: 'shiftEndReminders',
});

const KEY_BY_TYPE = new Map(
  Object.entries(EVENTS).flatMap(([key, event]) => event.types.map((type) => [type, key])),
);

/** The event a notification type belongs to, or null when it isn't configurable. */
export function prefKeyForType(type) {
  return KEY_BY_TYPE.get(type) ?? null;
}

/** The team setting that governs a notification type, or null. */
export function orgSettingForType(type) {
  const key = prefKeyForType(type);
  return (key && ORG_SETTING_FOR_EVENT[key]) || null;
}

/** A user's effective setting for one event: what they saved over its default. */
export function eventSetting(prefs, key) {
  const { desktop, phone } = EVENTS[key];
  return { desktop, phone, ...prefs?.events?.[key] };
}

/** A user's level for one team's Huddle. */
export function teamLevel(prefs, teamId) {
  return prefs?.teams?.[teamId] ?? DEFAULT_TEAM_LEVEL;
}

/** A user's quiet-time settings, with every field present. */
export function quietSettings(prefs) {
  return {
    holdOffShift: false,
    snoozeUntil: null,
    snoozeUntilClockIn: false,
    skipWhileViewing: true,
    ...prefs?.quiet,
  };
}

/** Whether deciding this user's delivery needs to know if they're clocked in. */
export function needsClockState(prefs) {
  return quietSettings(prefs).holdOffShift;
}

/** Whether quiet time holds the push for event `key` right now. */
function pushHeld(prefs, key, { now = new Date(), clockedIn = true, viewingTeam = false } = {}) {
  const quiet = quietSettings(prefs);
  if (quiet.snoozeUntil && new Date(quiet.snoozeUntil) > now) return true;
  // Set until the next clock-in, which clears it (clockStart), so it holds
  // even when picked mid-shift.
  if (quiet.snoozeUntilClockIn) return true;
  if (!HUDDLE_EVENTS.has(key)) return false;
  if (quiet.skipWhileViewing && viewingTeam) return true;
  return quiet.holdOffShift && !clockedIn && key !== 'huddleMention';
}

/** Every event's effective setting, for the Settings page. */
export function allEventSettings(prefs) {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, eventSetting(prefs, key)]));
}

/**
 * Decide one notification's delivery: `{ inbox, desktop, phone }`.
 *
 * `prefs` is the user's stored document, or null when they have none.
 * `ctx.type` is the notification's `data.type`; `ctx.teamId` its team, if any.
 * `ctx.now` and `ctx.clockedIn` feed quiet time; `clockedIn` only has to be
 * looked up when `needsClockState(prefs)` says so. `ctx.orgPolicy` is the
 * resolved team setting (`{ value, locked }`) for types that have one.
 * `ctx.viewingTeam` says the user has the notification's team's Huddle open.
 */
export function resolveDelivery(prefs, ctx) {
  const key = prefKeyForType(ctx.type);
  if (!key) return DELIVER_EVERYWHERE;
  if (ctx.teamId && DROPPED_BY_LEVEL[teamLevel(prefs, ctx.teamId)].has(key)) {
    return DELIVER_NOWHERE;
  }
  if (ctx.orgPolicy && !ctx.orgPolicy.value) return DELIVER_NOWHERE;
  const { desktop, phone } = ctx.orgPolicy?.locked ? EVENTS[key] : eventSetting(prefs, key);
  if (!desktop && !phone) {
    // Someone has to be able to answer an actionable event, so it stays in the
    // inbox even with both pop-ups off.
    return ACTIONABLE_EVENTS.has(key)
      ? { inbox: true, desktop: false, phone: false }
      : DELIVER_NOWHERE;
  }
  if (pushHeld(prefs, key, ctx)) return { inbox: true, desktop: false, phone: false };
  return { inbox: true, desktop, phone };
}

/**
 * Validate a patch from the client and flatten it into dotted `$set` paths.
 * Throws an Error naming the first bad field; the method turns it into a
 * Meteor.Error.
 *
 * Shape: `{ events?: { <eventKey>: { desktop?: boolean, phone?: boolean } },
 *          teams?: { <teamId>: 'all' | 'mentions' | 'mute' },
 *          quiet?: { holdOffShift?: boolean, snoozeUntil?: ISO date | null,
 *                    snoozeUntilClockIn?: boolean, skipWhileViewing?: boolean } }`.
 */
export function prefsPatchToSet(patch) {
  const set = {};
  for (const [key, devices] of Object.entries(patch?.events ?? {})) {
    if (!EVENTS[key]) throw new Error(`Unknown event: ${key}`);
    for (const [device, on] of Object.entries(devices ?? {})) {
      if (!DEVICES.includes(device)) throw new Error(`Unknown device: ${device}`);
      if (typeof on !== 'boolean') throw new Error(`${key}.${device} must be a boolean`);
      set[`events.${key}.${device}`] = on;
    }
  }
  for (const [teamId, level] of Object.entries(patch?.teams ?? {})) {
    if (!TEAM_ID_PATTERN.test(teamId)) throw new Error(`Invalid team: ${teamId}`);
    if (!TEAM_LEVELS.includes(level)) throw new Error(`Unknown team level: ${level}`);
    set[`teams.${teamId}`] = level;
  }
  for (const [field, value] of Object.entries(patch?.quiet ?? {})) {
    set[`quiet.${field}`] = quietValue(field, value);
  }
  if (Object.keys(set).length === 0) throw new Error('Nothing to update');
  return set;
}

/** One validated quiet-time field, as stored. */
function quietValue(field, value) {
  if (field === 'holdOffShift' || field === 'snoozeUntilClockIn' || field === 'skipWhileViewing') {
    if (typeof value !== 'boolean') throw new Error(`quiet.${field} must be a boolean`);
    return value;
  }
  if (field === 'snoozeUntil') {
    if (value === null) return null;
    const until = new Date(value);
    if (typeof value !== 'string' || Number.isNaN(until.getTime())) {
      throw new Error('quiet.snoozeUntil must be a date or null');
    }
    return until;
  }
  throw new Error(`Unknown quiet setting: ${field}`);
}
