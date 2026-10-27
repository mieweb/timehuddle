/**
 * The ticket record and the config format every ticket source is described in
 * (#734, step 2).
 *
 * A source (Redmine, GitHub, TimeHuddle itself, later Jira) is described by a
 * definition: plain data saying how to sign in, where an issue lives, where
 * each of the record's fields is in the source's answer, and which fields can
 * be edited. What plain data can't say is a named hook (`hook('name')`); the
 * backend registers what each name does. Definitions hold no functions, so the
 * front end and the backend can both import them.
 *
 * Plain JS with `index.d.ts` for types, like `@timehuddle/ota-version`, so the
 * Meteor backend imports it without a build step.
 */

/**
 * The fields of the ticket record: the one shape every source is translated
 * into. Types are in `index.d.ts`.
 */
export const RECORD_FIELDS = Object.freeze([
  'title',
  'body',
  'status',
  'priority',
  'assignees',
  'reporter',
  'labels',
  'type',
  'container',
  'milestone',
  'dates',
  'conversation',
  'attachments',
  'relations',
  'extra',
]);

const AUTH_SCHEMES = ['none', 'header', 'bearer'];
const PAGING_STYLES = ['offset', 'link-header'];
const BODY_FORMATS = ['markdown', 'textile', 'plain'];
/** What a definition's `id` may say. Nothing styles an ID: every source's looks the same. */
const ID_KEYS = ['hosts', 'match', 'show'];
const KIND_RE = /^[a-z][a-z0-9-]*$/;

/** A named step the backend supplies, for what plain data can't express. */
export function hook(name) {
  if (typeof name !== 'string' || !name) throw new Error('A hook needs a name');
  return Object.freeze({ hook: name });
}

/** Whether `value` is a `hook(...)`. */
export function isHook(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.hook === 'string';
}

function fail(kind, message) {
  throw new Error(`Ticket source "${kind}": ${message}`);
}

/** Refuse a function anywhere in a definition: it must stay plain data. */
function assertData(kind, value, where) {
  if (typeof value === 'function') fail(kind, `${where} is a function; use hook('name') instead`);
  if (value && typeof value === 'object' && !(value instanceof RegExp)) {
    for (const [key, inner] of Object.entries(value)) assertData(kind, inner, `${where}.${key}`);
  }
}

// Children first, and through a parent that is frozen already: a caller may
// hand in `Object.freeze({ title: { path } })`, whose `title` is still open.
function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value)) deepFreeze(inner, seen);
  return Object.freeze(value);
}

/**
 * Check a source definition and freeze it. Throws an Error naming the source
 * and what is wrong.
 */
export function defineSource(definition) {
  const kind = definition?.kind;
  if (typeof kind !== 'string' || !KIND_RE.test(kind)) {
    throw new Error(`Ticket source kind must be lowercase letters, digits or dashes: ${kind}`);
  }
  assertData(kind, definition, 'definition');
  if (typeof definition.label !== 'string' || !definition.label) fail(kind, 'label is required');

  const { connect = { auth: 'none' }, id = {}, api = {}, fields = {}, can = {} } = definition;
  if (!AUTH_SCHEMES.includes(connect.auth))
    fail(kind, `connect.auth must be one of ${AUTH_SCHEMES}`);
  if (connect.auth === 'header' && !connect.header) fail(kind, 'connect.header is required');
  if (api.paging !== undefined && !PAGING_STYLES.includes(api.paging)) {
    fail(kind, `api.paging must be one of ${PAGING_STYLES}`);
  }

  for (const key of Object.keys(id)) {
    if (!ID_KEYS.includes(key)) fail(kind, `id.${key} is not allowed; an ID is plain text`);
  }
  if (typeof id.show !== 'string' || !id.show.includes('{key}')) {
    fail(kind, 'id.show must be a template containing {key}');
  }
  if (id.match !== undefined && !(id.match instanceof RegExp))
    fail(kind, 'id.match must be a RegExp');
  // Frozen, a g or y regex can't move its lastIndex, so matching with it throws.
  if (id.match?.global || id.match?.sticky) fail(kind, 'id.match must not use the g or y flag');

  for (const [name, spec] of Object.entries(fields)) {
    if (!RECORD_FIELDS.includes(name))
      fail(kind, `fields.${name} is not a field of the ticket record`);
    if (!spec || typeof spec !== 'object') fail(kind, `fields.${name} must be an object`);
    const readable = typeof spec.path === 'string' || spec.groups || isHook(spec.from);
    if (spec.edit && !readable)
      fail(kind, `fields.${name} is editable but has nowhere to read it from`);
    if (spec.format !== undefined && !BODY_FORMATS.includes(spec.format)) {
      fail(kind, `fields.${name}.format must be one of ${BODY_FORMATS}`);
    }
    if (spec.ranks !== undefined && !Object.values(spec.ranks).every(Number.isFinite)) {
      fail(kind, `fields.${name}.ranks must map names to numbers`);
    }
  }
  for (const [name, value] of Object.entries(can)) {
    if (typeof value !== 'boolean' && !isHook(value))
      fail(kind, `can.${name} must be true, false or a hook`);
  }

  return deepFreeze({ ...definition, connect, id, api, fields, can });
}

/**
 * Where the issue at `url` is, by `definition`: `{ container?, key }`, or null
 * when the address isn't one of its issues. `id.match` runs on the path and
 * names its parts with `(?<container>...)` and `(?<key>...)`; `id.hosts`, when
 * set, limits the hosts.
 */
export function matchIssueUrl(definition, url) {
  const parsed = parseUrl(url);
  if (!parsed || !definition.id.match) return null;
  const hosts = definition.id.hosts;
  if (hosts && !hosts.includes(parsed.hostname.toLowerCase())) return null;
  const groups = parsed.pathname.match(definition.id.match)?.groups;
  if (!groups?.key) return null;
  return groups.container ? { container: groups.container, key: groups.key } : { key: groups.key };
}

/**
 * The ID an issue is shown by, from `definition`'s `id.show` template:
 * `{prefix}`, `{key}`, `{container}`, and `{repo}` (the container's last
 * segment). Plain text: every source's IDs look the same.
 */
export function showId(definition, ref, prefix = '') {
  const container = ref.container ?? '';
  const values = { prefix, key: ref.key, container, repo: container.split('/').pop() };
  return definition.id.show.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

/** A number at the end of the path, before any query or fragment. */
const TRAILING_NUMBER = /\/(\d+)\/?$/;

function parseUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/**
 * The outside ID for `url` (#689), or null when it isn't one we can name:
 *
 * - a GitHub issue or pull request is `<repo>-<number>`, with no setup;
 * - an address on a server the organization has named (`prefixes`, as
 *   `{ host, prefix }`) and ending in a number is `<prefix>-<number>`.
 *
 * Named servers have no kind yet (that's the server registry, #734 step 5), so
 * any address on one that ends in a number counts.
 */
export function outsideIdOfWith(github, url, prefixes) {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();

  if (github.id.hosts.includes(host)) {
    const ref = matchIssueUrl(github, parsed.href);
    return ref ? showId(github, ref) : null;
  }

  const named = prefixes.find((entry) => entry.host === host);
  const number = parsed.pathname.match(TRAILING_NUMBER)?.[1];
  return named && number ? `${named.prefix}-${number}` : null;
}
