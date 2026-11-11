/**
 * What a Pulse link says about where its video goes, with no Meteor or
 * database (pulse-destinations.js reads the names as it checks the
 * destination; pulsevault.js signs the `ref` and hands the rest to the page
 * that builds the link).
 *
 * A link is still one upload. These hints let Pulse open its recorder on the
 * right draft: the same place gets the same `ref` every time, so a second
 * link for a ticket finds the recording already started for it.
 *  - `ref`, signed into the upload token: the place's key, one per person
 *    and place. Pulse reads it from the token and only ever compares it, so
 *    it is a short hash of `<userId>:<kind>[:<key>]` rather than that
 *    spelled out: the token rides in every link, and a QR has to stay small.
 *  - `label`, on the link: what the place is called in Pulse, specific enough
 *    to tell two apart ("Platform · Huddle").
 *  - `name`, on the link: what a new recording made from it is called, where
 *    the person liked seeing one as content. A wrap-up's line is plain without.
 */
import { createHash } from 'crypto';

/** How much of the hash a `ref` keeps, in base64url characters (96 bits). */
const REF_LENGTH = 16;

/**
 * Longest `label` and `name` sent, in characters (Unicode code points): what a
 * Pulse draft's name takes. PulseVault itself would take 60 and 80.
 */
const MAX_HINT_LENGTH = 40;

/**
 * And in the characters one takes in the link, where it is percent-encoded:
 * a letter is 1, but a CJK character is 9 and an emoji 12 or more, and the
 * title of a ticket goes on the link twice. 40 of those made a QR code of 121
 * to 133 modules a side, against 89 for 40 Latin letters; held to this, any
 * title's code is at most 97 a side (measured with a production link).
 */
const MAX_HINT_ENCODED = 120;

/** What a cut text ends in. */
const ELLIPSIS = '…';

/** How many characters `text` takes in a link's parameters, as `URLSearchParams` writes it. */
function encodedLength(text) {
  return new URLSearchParams({ t: text }).toString().length - 2;
}

/** Whether all `text` holds is whitespace and format characters (zero-width spaces, joiners). */
const isBlank = (text) => /^[\s\p{Cf}]*$/u.test(text);

/**
 * One line of plain text, as @mieweb/pulsevault's `buildUploadLink` cleans a
 * hint (PROTOCOL.md §3.1), so what `reserve` returns is what the link carries:
 * control characters and line breaks become a space, and
 * bidirectional-formatting characters (which can reorder the text shown around
 * them) are dropped. Blank or invisible: none. A ticket's title and a team's
 * name are whatever someone typed, or sent.
 */
function cleanText(value) {
  if (typeof value !== 'string') return '';
  const text = value
    .toWellFormed()
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\p{Bidi_Control}/gu, '')
    .trim();
  return isBlank(text) ? '' : text;
}

/**
 * Cleaned, and cut to fit both `max` characters and `maxEncoded` in the link,
 * at a whole user-perceived character (never through an emoji sequence or an
 * accent), ending in "…" when cut. None when what is left once cut shows as
 * nothing (a name that starts with 40 zero-width characters): an ellipsis
 * alone names no place.
 */
function displayText(value, max = MAX_HINT_LENGTH, maxEncoded = MAX_HINT_ENCODED) {
  const text = cleanText(value);
  if (Array.from(text).length <= max && encodedLength(text) <= maxEncoded) return text;
  let cut = '';
  let length = 1; // the ellipsis
  let encoded = encodedLength(ELLIPSIS);
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    length += Array.from(segment).length;
    encoded += encodedLength(segment);
    if (length > max || encoded > maxEncoded) break;
    cut += segment;
  }
  return isBlank(cut) ? '' : cut.trimEnd() + ELLIPSIS;
}

/** `<team> · <what>`, the team's name cut so the whole label fits; `fallback` without one. */
function teamLabel(team, what, fallback) {
  const suffix = ` · ${what}`;
  const name = displayText(team, MAX_HINT_LENGTH - suffix.length, MAX_HINT_ENCODED - encodedLength(suffix));
  return name ? name + suffix : fallback;
}

/** The `ref` of the place `spelled` (`<userId>:<kind>[:<key>]`) names: opaque, and the same every time. */
function placeRef(spelled) {
  return createHash('sha256').update(spelled).digest('base64url').slice(0, REF_LENGTH);
}

/**
 * The destination kinds that are a place: the part of its key that names
 * it (from the resolved destination), and its two names, from what it's
 * called in TimeHuddle (`{ team, title }`, either may be missing). `post` and
 * `walkthrough` (a file a form attaches later) are not places: their links
 * stay plain.
 */
const PLACES = {
  library: { key: () => '', label: () => 'Media library' },
  ticket: {
    key: (d) => d.id,
    label: ({ title }) => title || 'Ticket video',
    name: ({ title }) => title,
  },
  clock: { key: (d) => d.id, label: () => 'Session video' },
  huddle: {
    key: (d) => d.teamId,
    label: ({ team }) => teamLabel(team, 'Huddle', 'Huddle update'),
    name: () => 'Huddle update',
  },
  'timesheet-request': {
    key: (d) => d.id,
    label: () => 'Timesheet walkthrough',
    name: () => 'Walkthrough',
  },
  'clock-plan': {
    key: (d) => `${d.teamId}:${d.postDate}`,
    label: ({ team }) => teamLabel(team, 'Clock-in plan', 'Clock-in plan'),
    name: () => 'Clock-in plan',
  },
  'clock-wrapup': {
    key: (d) => d.clockEventId,
    label: ({ team }) => teamLabel(team, 'Wrap-up', 'Wrap-up'),
  },
};

/**
 * A team, as the check of a destination in it returns it: the id to sign, and
 * its name for the link. The id is the team's own as it is written, however
 * the caller spelled it (a legacy id is hex, found in either case): one team
 * is one place, with one `ref`.
 */
export function teamPlace(team) {
  return { teamId: String(team._id), names: { team: team.name } };
}

/**
 * What a destination's check returned, taken apart: `resolved`, its kind and
 * the fields to sign into the token, and `names`, what it is called
 * (`{ team?, title? }`), which is never signed.
 */
export function resolvedPlace(kind, { names = {}, ...signed }) {
  return { resolved: { kind, ...signed }, names };
}

/** Whether a destination kind is a place a link carries hints for. */
export function isPulsePlace(kind) {
  return Object.hasOwn(PLACES, kind ?? '');
}

/**
 * The hints for a destination that resolved (`resolvePulseDestination`):
 * `{ ref, label, name? }`, or null for a kind that isn't a place, whose link
 * stays plain. `names` is `{ team?, title? }`,
 * what the destination is called in TimeHuddle; without them the label is the
 * kind's plain one.
 */
export function pulseLinkHints(userId, resolved, names = {}) {
  const place = isPulsePlace(resolved?.kind) ? PLACES[resolved.kind] : null;
  if (!place || !userId) return null;
  const key = place.key(resolved);
  const called = { team: cleanText(names.team), title: cleanText(names.title) };
  const name = displayText(place.name?.(called));
  return {
    ref: placeRef([userId, resolved.kind, ...(key ? [key] : [])].join(':')),
    // The plain label too when nothing of the name survives the cut (one
    // character of 40 accents, or 40 that show as nothing).
    label: displayText(place.label(called)) || place.label({}),
    ...(name ? { name } : {}),
  };
}
