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
  mute: new Set(['huddleMention', 'huddleReply', 'huddlePost']),
};

/** Team ids are Mongo hex or legacy Meteor ids: safe to use in a dotted path. */
const TEAM_ID_PATTERN = /^[A-Za-z0-9]{7,32}$/;

const KEY_BY_TYPE = new Map(
  Object.entries(EVENTS).flatMap(([key, event]) => event.types.map((type) => [type, key])),
);

/** The event a notification type belongs to, or null when it isn't configurable. */
export function prefKeyForType(type) {
  return KEY_BY_TYPE.get(type) ?? null;
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

/** Every event's effective setting, for the Settings page. */
export function allEventSettings(prefs) {
  return Object.fromEntries(EVENT_KEYS.map((key) => [key, eventSetting(prefs, key)]));
}

/**
 * Decide one notification's delivery: `{ inbox, desktop, phone }`.
 *
 * `prefs` is the user's stored document, or null when they have none.
 * `ctx.type` is the notification's `data.type`; `ctx.teamId` its team, if any.
 */
export function resolveDelivery(prefs, ctx) {
  const key = prefKeyForType(ctx.type);
  if (!key) return DELIVER_EVERYWHERE;
  if (ctx.teamId && DROPPED_BY_LEVEL[teamLevel(prefs, ctx.teamId)].has(key)) {
    return DELIVER_NOWHERE;
  }
  const { desktop, phone } = eventSetting(prefs, key);
  if (!desktop && !phone) return DELIVER_NOWHERE;
  return { inbox: true, desktop, phone };
}

/**
 * Validate a patch from the client and flatten it into dotted `$set` paths.
 * Throws an Error naming the first bad field; the method turns it into a
 * Meteor.Error.
 *
 * Shape: `{ events?: { <eventKey>: { desktop?: boolean, phone?: boolean } },
 *          teams?: { <teamId>: 'all' | 'mentions' | 'mute' } }`.
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
  if (Object.keys(set).length === 0) throw new Error('Nothing to update');
  return set;
}
