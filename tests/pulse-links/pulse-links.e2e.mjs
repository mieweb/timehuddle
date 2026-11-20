// Pulse links, end to end against a running local backend, without a phone:
// reserve a link for a place, read what it tells Pulse, upload as Pulse does.
// Run with `npm run e2e:pulse-links`, by hand: it is not for CI, and it posts
// to the backend it runs against. See README.md for what it needs and leaves.
import { createHash } from 'node:crypto';

import { buildUploadLink } from '@mieweb/pulsevault/core';

import { BASE, callMethod, checklist, claimsOf, devLogin, tusUpload, waitFiled } from './lib.mjs';

const role = process.env.TH_ROLE ?? 'member';
const { section, check, skip, note, finish } = checklist();

const session = await devLogin(role);
console.log(`Signed in to ${BASE} as ${role} (${session.id})`);

/** The ref of the place spelled `<userId>:<kind>:<key>`: opaque, and the same every time. */
const refOf = (kind, key) =>
  createHash('sha256').update(`${session.id}:${kind}:${key}`).digest('base64url').slice(0, 16);
/** How many characters `text` takes in a link's parameters, where it is percent-encoded. */
const encoded = (text) => new URLSearchParams({ t: text }).toString().length - 2;
/**
 * `text` as a link's hint carries it, cleaned by @mieweb/pulsevault's own
 * builder: a line break or control character becomes a space, and
 * bidirectional-formatting characters go. A title is stored as typed.
 */
const asHint = (text) => {
  const link = buildUploadLink({
    server: BASE,
    artifactId: 'x',
    token: 'x',
    label: text,
    form: 'https',
  });
  return new URLSearchParams(new URL(link).hash.slice(1)).get('label') ?? '';
};
/** Whether all `text` holds is whitespace and format characters (zero-width spaces, joiners). */
const isBlank = (text) => /^[\s\p{Cf}]*$/u.test(text);
/** Room for a name on a link: 40 characters, and 120 once encoded. */
const HINT = { max: 40, maxEncoded: 120 };
/**
 * Whether `shown` is how a link names something called `full` in `room`: all
 * of it when it fits, else its start and an ellipsis. Never a name that shows
 * as nothing.
 */
function namedFor(shown, full, { max, maxEncoded } = HINT) {
  if (typeof shown !== 'string' || isBlank(shown)) return false;
  if ([...shown].length > max || encoded(shown) > maxEncoded) return false;
  const whole = asHint(full);
  return shown === whole || (shown.endsWith('…') && whole.startsWith(shown.slice(0, -1)));
}
/**
 * Whether nothing of `full` can show in `room`, so the server names the place
 * plainly instead: it doesn't fit whole, and its start up to its first
 * visible character, with the ellipsis a cut ends in, doesn't fit either (a
 * title that starts with 60 zero-width characters, each 9 characters once
 * encoded), or it is blank once cleaned. The package's builder keeps 60
 * characters of a hint, more than any room here, so what it drops can't fit.
 */
function showsAsNothing(full, room = HINT) {
  const whole = asHint(full);
  if (namedFor(whole, full, room)) return false;
  let start = '';
  for (const { segment } of new Intl.Segmenter().segment(whole)) {
    start += segment;
    if (!isBlank(segment)) return !namedFor(`${start}…`, full, room);
  }
  return true;
}

/** What a TimeHuddle page gets for its link. */
async function reserve(destination) {
  const { status, result, body } = await callMethod(session, 'pulsevault.reserve', { destination });
  if (!result?.uploadToken) {
    throw new Error(`pulsevault.reserve failed: ${status} ${JSON.stringify(body)}`);
  }
  return result;
}

/**
 * One place, from its link to its video: the reservation names it, the token
 * signs its key, the names go on a link as they are, and a video uploaded with
 * the link's own id and token is delivered. `isLabel` and `isName` say whether
 * a label and a name are the ones expected.
 */
async function checkPlace(destination, { key, called, isLabel, isName }) {
  const reserved = await reserve(destination);
  const claims = claimsOf(reserved.uploadToken);
  check(`it is called ${called.label}`, isLabel(reserved.label), reserved.label);
  check(`a new recording is called ${called.name}`, isName(reserved.name), reserved.name);
  check(
    "the token signs the place's key, a short hash",
    claims.ref === refOf(destination.kind, key) && reserved.ref === claims.ref,
    { claim: claims.ref, returned: reserved.ref },
  );
  check('for the one upload the link is for', claims.artifactId === reserved.videoid, claims);
  check(
    'the same place has the same key on its next link',
    (await reserve(destination)).ref === claims.ref,
  );

  // Not the page's own link: this script can't run the page. This is the
  // package's builder, which pulseLinks.test.ts holds the page's to. What it
  // shows here is that the server's names need no more cleaning or cutting.
  const link = buildUploadLink({
    server: `${BASE}/pulsevault`,
    artifactId: reserved.videoid,
    token: reserved.uploadToken,
    label: reserved.label,
    name: reserved.name,
    form: 'https',
  });
  const params = new URLSearchParams(new URL(link).hash.slice(1));
  check(
    "@mieweb/pulsevault's link carries the names as reserved, and never the key",
    params.get('label') === reserved.label &&
      (params.get('name') ?? undefined) === reserved.name &&
      !params.has('ref'),
    [...params.entries()].filter(([param]) => param !== 'token'),
  );
  console.log(`       that link, as a QR would carry it: ${link.length} characters`);

  await tusUpload(reserved.videoid, reserved.uploadToken, reserved.name);
  const outcome = await waitFiled(reserved.videoid, reserved.uploadToken);
  check('a video uploaded with it is delivered', outcome.state === 'done', outcome);
}

const listed = (await callMethod(session, 'teams.list')).result;
const teams = Array.isArray(listed) ? listed : (listed?.teams ?? []);
const team = teams.find((candidate) => !candidate.isPersonal) ?? teams[0];
if (!team) {
  // Nothing can be reserved for: a failure, not a pass with nothing checked.
  check(`${role} is in a team to make links for`, false, teams);
  finish();
}
const teamId = String(team.id ?? team._id);

section("A team's Huddle");
const HUDDLE = ' · Huddle';
/** What is left of a label's room for the team's name. */
const TEAM_ROOM = {
  max: HINT.max - [...HUDDLE].length,
  maxEncoded: HINT.maxEncoded - encoded(HUDDLE),
};
await checkPlace(
  { kind: 'huddle', teamId },
  {
    key: teamId,
    called: {
      label: `"${team.name}${HUDDLE}", or "Huddle update" when none of the name shows`,
      name: '"Huddle update"',
    },
    // The team's name is cut, never what the place is.
    isLabel: (label) =>
      (label?.endsWith(HUDDLE) && namedFor(label.slice(0, -HUDDLE.length), team.name, TEAM_ROOM)) ||
      (label === 'Huddle update' && showsAsNothing(team.name, TEAM_ROOM)),
    isName: (name) => name === 'Huddle update',
  },
);

// A legacy team's id is hex, which the server finds in either case: one team
// must stay one place, signed by the team's own id.
if (/^[0-9a-f]{24}$/.test(teamId)) {
  const shouted = await reserve({ kind: 'huddle', teamId: teamId.toUpperCase() });
  const claims = claimsOf(shouted.uploadToken);
  check(
    "a team's id in another case is the same place, signed by the team's own id",
    shouted.ref === refOf('huddle', teamId) && claims.ctx?.destination?.teamId === teamId,
    { ref: shouted.ref, signed: claims.ctx?.destination },
  );
} else {
  note("a team's id in another case", "this team's id isn't hex, so it has no other case");
}

section('A ticket');
const tickets = (await callMethod(session, 'tickets.list', { teamId, brief: true })).result;
const ticket =
  (Array.isArray(tickets) ? tickets : (tickets?.tickets ?? []))[0] ??
  (await callMethod(session, 'tickets.create', { teamId, title: 'Pulse links e2e' })).result;
const ticketId = ticket && String(ticket.id ?? ticket._id);
if (!ticket?.title || !ticketId) {
  skip('ticket link', `no ticket in ${team.name}, and none could be made`);
} else {
  await checkPlace(
    { kind: 'ticket', id: ticketId },
    {
      key: ticketId.toLowerCase(),
      called: {
        label: `by its title, "${ticket.title}", or "Ticket video" when none of it shows`,
        name: 'the same, or nothing when none of it shows',
      },
      isLabel: (label) =>
        namedFor(label, ticket.title) || (label === 'Ticket video' && showsAsNothing(ticket.title)),
      isName: (name) =>
        name === undefined ? showsAsNothing(ticket.title) : namedFor(name, ticket.title),
    },
  );
}

section('A destination that is not a place');
const post = await reserve({ kind: 'post' });
check(
  'its link stays plain: no key, no names',
  claimsOf(post.uploadToken).ref === undefined &&
    post.ref === undefined &&
    post.label === undefined,
  post,
);

finish();
