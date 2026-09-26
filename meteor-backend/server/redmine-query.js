/**
 * Reading what the user typed into the Tickets search bar (MVP2 A2).
 *
 * Search is the escape hatch that makes MVP2's narrow relevant list acceptable:
 * the list only shows a user their own work, so anything else has to be findable
 * by typing. Four things are worth typing, and they want four different Redmine
 * calls:
 *
 *   - `#1234` or `1234` — an issue number. One `GET /issues/{id}.json`.
 *   - a pasted Redmine link — the same, once the id is taken out of it.
 *   - `@alex` — whoever that is, and what is on their plate.
 *   - anything else — words, matched against issue **titles** only.
 *
 * Deciding which of those it is happens here, before any request, so exactly one
 * bounded call follows. `value: null` means there is nothing to ask Redmine: the
 * query is too short, or it is a link to somewhere that is not the user's own
 * instance. The caller answers an empty list, and `kind` lets the UI say why
 * without the server having to phrase it.
 *
 * Pure and Meteor-free, so every reading of a query can be tested as a table
 * (see tests/redmine-query.test.ts).
 */

/**
 * Shortest query worth sending. Two letters match a large fraction of any issue
 * tracker, so the result would be noise and the request pure cost. Issue numbers
 * are exempt: `#7` is not a vague query, it is an exact one.
 */
export const MIN_QUERY_LENGTH = 3;

/** How many issues a search may return. */
export const MAX_SEARCH_RESULTS = 25;

const ISSUE_NUMBER = /^#?([1-9]\d*)$/;
const ASSIGNEE = /^@(.+)$/;

/**
 * Read a raw query into `{ kind, value }`.
 *
 * @param {unknown} raw       what the user typed
 * @param {string|null} baseUrl  the instance their key belongs to, for link checking
 * @returns {{kind: 'id'|'url'|'assignee'|'text', value: number|string|null}}
 */
export function parseRedmineQuery(raw, baseUrl = null) {
  const query = typeof raw === 'string' ? raw.trim() : '';

  // A link is checked first: it contains digits and spaces-free text that the
  // other rules would happily misread.
  if (/^https?:\/\//i.test(query)) return { kind: 'url', value: issueIdFromUrl(query, baseUrl) };

  const numbered = query.match(ISSUE_NUMBER);
  if (numbered) {
    const id = Number(numbered[1]);
    return { kind: 'id', value: Number.isSafeInteger(id) ? id : null };
  }

  if (query.length < MIN_QUERY_LENGTH) {
    // Reported as the kind it would have been, so "@a" — or a bare "@", where no
    // name has been typed yet — can be answered with "type more of the name"
    // rather than a generic shrug.
    return { kind: query.startsWith('@') ? 'assignee' : 'text', value: null };
  }

  const assignee = query.match(ASSIGNEE);
  if (assignee) {
    const name = assignee[1].trim();
    return { kind: 'assignee', value: name.length ? name : null };
  }

  return { kind: 'text', value: query };
}

/**
 * The issue id in a pasted Redmine URL, or null.
 *
 * Only the user's own instance is accepted. A link to a different Redmine is not
 * a near miss to be searched for anyway: its issue numbers belong to a different
 * namespace, so following it would open an unrelated issue with a straight face.
 * Redmine may live under a sub-path, so the base URL's path has to match too.
 */
function issueIdFromUrl(raw, baseUrl) {
  if (!baseUrl) return null;

  let url;
  let base;
  try {
    url = new URL(raw);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.origin !== base.origin) return null;

  const basePath = base.pathname.replace(/\/+$/, '');
  if (basePath && !url.pathname.startsWith(`${basePath}/`)) return null;

  const id = url.pathname.slice(basePath.length).match(/^\/issues\/([1-9]\d*)\/?$/)?.[1];
  if (!id) return null;
  const issueId = Number(id);
  return Number.isSafeInteger(issueId) ? issueId : null;
}

/**
 * The people an `@name` query could mean, out of the users the caller shares a
 * project with.
 *
 * An exact name wins outright, so `@Alex Kim` is not made ambiguous by an
 * `Alex Kimura` in another project. Otherwise any user whose full name contains
 * the query, or any of whose names starts with it, counts — which is what makes
 * `@alex` find "Alex Kim" and `@kim` find her too.
 *
 * Several matches are returned rather than resolved: the caller asks the user to
 * type more of the name instead of guessing which colleague they meant.
 *
 * @param {{id: number, name: string}[]} users
 * @param {string} name
 */
export function matchAssignees(users, name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return [];

  const candidates = (Array.isArray(users) ? users : []).filter((user) => user?.id != null);

  const exact = candidates.filter((user) => String(user.name ?? '').trim().toLowerCase() === wanted);
  if (exact.length) return exact;

  return candidates.filter((user) => {
    const full = String(user.name ?? '').trim().toLowerCase();
    return full.includes(wanted) || full.split(/\s+/).some((part) => part.startsWith(wanted));
  });
}
