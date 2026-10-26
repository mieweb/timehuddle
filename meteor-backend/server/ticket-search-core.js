/**
 * Finding tickets by an ID someone typed (#736c).
 *
 * Every row is a ticket since #736, but a ticket goes by several IDs, and the
 * Tickets table only filters the rows already on screen. These rules turn what
 * was typed into a Mongo selector over the caller's teams:
 *
 *   - `THX-12` — tickets numbered 12 in an org whose prefix is THX
 *   - `RM0-233` — tickets carrying issue 233 on the server an org named RM0,
 *     or whose link points at it
 *   - `timehuddle-223` — tickets whose GitHub link is issue or PR 223 of a repo
 *     called timehuddle, in any owner's account
 *   - `223` or `#223` — any ticket where 223 is one of those numbers
 *
 * A name and a dash are a search by prefix: `THX-` is every THX ticket, and
 * `THX-1` every one whose number starts with 1. A bare number only ever
 * matches whole. The caller asks for the exact match too (`{ exact: true }`),
 * so it can come first.
 *
 * A prefix is matched against what the org calls it now, so a ticket is not
 * found under a prefix the org has since renamed.
 *
 * No Meteor imports, so this is unit-testable (tests/ticket-search-core.test.ts).
 */
import { DEFAULT_TICKET_IDS } from './ticket-ids';

/** How many tickets one lookup may return. */
export const MAX_REF_RESULTS = 25;

const BARE_NUMBER = /^#?([1-9]\d*)$/;
// A prefix, or a GitHub repo name (which may hold dots, underscores and
// dashes), a dash, and the start of a number, or none of it yet.
const NAMED_REF = /^([A-Za-z0-9][A-Za-z0-9._-]*?)-(\d*)$/;

/**
 * Read a raw query into `{ name, digits }`, `name` null for a bare number, or
 * null when it is not an ID at all (words, `@name`, a link). `digits` may be
 * empty after a name: `THX-`.
 */
export function parseTicketRef(raw) {
  const query = typeof raw === 'string' ? raw.trim() : '';
  const bare = query.match(BARE_NUMBER);
  if (bare) return Number.isSafeInteger(Number(bare[1])) ? { name: null, digits: bare[1] } : null;
  const named = query.match(NAMED_REF);
  if (!named || named[2].length > 15) return null;
  return { name: named[1], digits: named[2] };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The digits a number may be, as a regex source: exactly `digits`, or any
 * number starting with them.
 */
const numberPattern = (digits, exact) => (exact ? digits : `${digits}\\d${digits ? '*' : '+'}`);

// The ends of a link, the way `outsideIdOf` (src/features/tickets/ticketIds.ts)
// reads them: the number closes the path, before any query or fragment.
const numberEndingPath = (pattern) => `/${pattern}/?(?:[?#].*)?$`;

/** A link on any server whose path ends in the number. */
const anyLinkTo = (pattern) => new RegExp(numberEndingPath(pattern));

/** A link on `host` whose path ends in the number. */
const linkOnHostTo = (host, pattern) =>
  new RegExp(
    `^https://${escapeRegExp(host)}(?::\\d+)?(?:/[^?#]*)?${numberEndingPath(pattern)}`,
    'i',
  );

/** A GitHub issue or PR of a repo called `repo`, as `GITHUB_ISSUE_URL_RE` reads it. */
const githubIssue = (repo, pattern) =>
  new RegExp(`github\\.com/[^/?#]+/${escapeRegExp(repo)}/(?:issues|pull)/${pattern}(?!\\d)`, 'i');

/** A ticket's own number: whole when exact, else read as text and matched from the start. */
function ownNumber(digits, exact) {
  if (exact) return { number: Number(digits) };
  if (!digits) return { number: { $exists: true } };
  return {
    $expr: { $regexMatch: { input: { $toString: '$number' }, regex: `^${digits}` } },
  };
}

/**
 * Tickets linked to a Redmine issue on `host`. A link with no host is on the
 * deployment's own Redmine (`redmineHost`): links made before the host was
 * stored read that way.
 */
function carriedOn(host, pattern, redmineHost) {
  const selector = {
    'linkedIssue.source': 'redmine',
    'linkedIssue.id': new RegExp(`^${pattern}$`),
  };
  return host === redmineHost
    ? {
        ...selector,
        $or: [{ 'linkedIssue.host': host }, { 'linkedIssue.host': { $exists: false } }],
      }
    : { ...selector, 'linkedIssue.host': host };
}

/**
 * The Mongo selector for the tickets `ref` names, or null when it can name
 * none. A bare number is always matched whole; a named one by prefix unless
 * `exact`.
 *
 * @param {{name: string|null, digits: string}} ref  from `parseTicketRef`
 * @param {object} scope
 * @param {{id: string, orgId: string|null}[]} scope.teams  the caller's teams
 * @param {Map<string, {ticketPrefix: string, sourcePrefixes: {host: string, prefix: string}[]}>} scope.idsByOrg
 *   from `ticketIdsFor`; a team whose org is missing gets the defaults
 * @param {string|null} scope.redmineHost  the deployment's own Redmine host
 * @param {{exact?: boolean}} [options]
 */
export function ticketRefSelector(
  { name, digits },
  { teams, idsByOrg, redmineHost },
  { exact = false } = {},
) {
  const idsOf = (team) => (team.orgId && idsByOrg.get(team.orgId)) || DEFAULT_TICKET_IDS;
  const inTeams = (list) => ({ teamId: { $in: list.map((team) => team.id) } });
  const clauses = [];

  if (name === null) {
    if (teams.length) {
      const all = inTeams(teams);
      clauses.push(
        { ...all, number: Number(digits) },
        { ...all, 'linkedIssue.id': digits },
        { ...all, github: anyLinkTo(digits) },
      );
    }
  } else {
    if (exact && !digits) return null;
    const pattern = numberPattern(digits, exact);
    const prefix = name.toUpperCase();
    const numbered = teams.filter((team) => idsOf(team).ticketPrefix === prefix);
    if (numbered.length) clauses.push({ ...inTeams(numbered), ...ownNumber(digits, exact) });

    // One org's prefix names one server, but two orgs may give it different hosts.
    const byHost = new Map();
    for (const team of teams) {
      const host = idsOf(team).sourcePrefixes.find((entry) => entry.prefix === prefix)?.host;
      if (host) byHost.set(host, [...(byHost.get(host) ?? []), team]);
    }
    for (const [host, onHost] of byHost) {
      clauses.push(
        { ...inTeams(onHost), ...carriedOn(host, pattern, redmineHost) },
        { ...inTeams(onHost), github: linkOnHostTo(host, pattern) },
      );
    }

    if (teams.length) clauses.push({ ...inTeams(teams), github: githubIssue(name, pattern) });
  }

  return clauses.length ? { status: { $ne: 'deleted' }, $or: clauses } : null;
}
