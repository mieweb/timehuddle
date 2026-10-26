/**
 * Finding tickets by an ID someone typed (#736c).
 *
 * Every row is a ticket since #736, but a ticket goes by several IDs, and the
 * Tickets table only filters the rows already on screen. These rules turn what
 * was typed into one Mongo selector over the caller's teams:
 *
 *   - `THX-12` — the ticket numbered 12 in an org whose prefix is THX
 *   - `RM0-233` — tickets carrying issue 233 on the server an org named RM0,
 *     or whose link points at it
 *   - `timehuddle-223` — tickets whose GitHub link is issue or PR 223 of a repo
 *     called timehuddle, in any owner's account
 *   - `223` or `#223` — any ticket where 223 is one of those numbers
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
// A prefix, or a GitHub repo name, which may also hold dots and underscores.
const NAMED_REF = /^([A-Za-z0-9][A-Za-z0-9._-]*)-([1-9]\d*)$/;

/**
 * Read a raw query into `{ name, number }`, `name` null for a bare number, or
 * null when it is not an ID at all (words, `@name`, a link).
 */
export function parseTicketRef(raw) {
  const query = typeof raw === 'string' ? raw.trim() : '';
  const bare = query.match(BARE_NUMBER);
  const named = bare ? null : query.match(NAMED_REF);
  const digits = bare?.[1] ?? named?.[2];
  if (!digits) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) ? { name: named?.[1] ?? null, number } : null;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The ends of a link, the way `outsideIdOf` (src/features/tickets/ticketIds.ts)
// reads them: the number closes the path, before any query or fragment.
const numberEndingPath = (number) => `/${number}/?(?:[?#].*)?$`;

/** A link on any server whose path ends in `number`. */
const anyLinkTo = (number) => new RegExp(numberEndingPath(number));

/** A link on `host` whose path ends in `number`. */
const linkOnHostTo = (host, number) =>
  new RegExp(`^https://${escapeRegExp(host)}(?::\\d+)?(?:/[^?#]*)?${numberEndingPath(number)}`, 'i');

/** GitHub issue or PR `number` of a repo called `repo`, as `GITHUB_ISSUE_URL_RE` reads it. */
const githubIssue = (repo, number) =>
  new RegExp(`github\\.com/[^/?#]+/${escapeRegExp(repo)}/(?:issues|pull)/${number}(?!\\d)`, 'i');

/**
 * Tickets linked to Redmine issue `issueId` on `host`. A link with no host is
 * on the deployment's own Redmine (`redmineHost`): links made before the host
 * was stored read that way.
 */
function carriedOn(host, issueId, redmineHost) {
  const selector = { 'linkedIssue.source': 'redmine', 'linkedIssue.id': issueId };
  return host === redmineHost
    ? { ...selector, $or: [{ 'linkedIssue.host': host }, { 'linkedIssue.host': { $exists: false } }] }
    : { ...selector, 'linkedIssue.host': host };
}

/**
 * The Mongo selector for the tickets `ref` names, or null when it can name
 * none.
 *
 * @param {{name: string|null, number: number}} ref  from `parseTicketRef`
 * @param {object} scope
 * @param {{id: string, orgId: string|null}[]} scope.teams  the caller's teams
 * @param {Map<string, {ticketPrefix: string, sourcePrefixes: {host: string, prefix: string}[]}>} scope.idsByOrg
 *   from `ticketIdsFor`; a team whose org is missing gets the defaults
 * @param {string|null} scope.redmineHost  the deployment's own Redmine host
 */
export function ticketRefSelector({ name, number }, { teams, idsByOrg, redmineHost }) {
  const idsOf = (team) => (team.orgId && idsByOrg.get(team.orgId)) || DEFAULT_TICKET_IDS;
  const inTeams = (list) => ({ teamId: { $in: list.map((team) => team.id) } });
  const issueId = String(number);
  const clauses = [];

  if (name === null) {
    if (teams.length) {
      const all = inTeams(teams);
      clauses.push(
        { ...all, number },
        { ...all, 'linkedIssue.id': issueId },
        { ...all, github: anyLinkTo(number) },
      );
    }
  } else {
    const prefix = name.toUpperCase();
    const numbered = teams.filter((team) => idsOf(team).ticketPrefix === prefix);
    if (numbered.length) clauses.push({ ...inTeams(numbered), number });

    // One org's prefix names one server, but two orgs may give it different hosts.
    const byHost = new Map();
    for (const team of teams) {
      const host = idsOf(team).sourcePrefixes.find((entry) => entry.prefix === prefix)?.host;
      if (host) byHost.set(host, [...(byHost.get(host) ?? []), team]);
    }
    for (const [host, onHost] of byHost) {
      clauses.push(
        { ...inTeams(onHost), ...carriedOn(host, issueId, redmineHost) },
        { ...inTeams(onHost), github: linkOnHostTo(host, number) },
      );
    }

    if (teams.length) clauses.push({ ...inTeams(teams), github: githubIssue(name, number) });
  }

  return clauses.length ? { status: { $ne: 'deleted' }, $or: clauses } : null;
}
