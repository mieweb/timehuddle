/**
 * @timehuddle/ticket-sources — the ticket record, the config format sources
 * are described in, and the definitions of the sources TimeHuddle knows
 * (#734). See README.md.
 */
import { outsideIdOfWith } from './core.js';
import { github } from './definitions/github.js';
import { redmine } from './definitions/redmine.js';
import { timehuddle } from './definitions/timehuddle.js';

export { RECORD_FIELDS, defineSource, hook, isHook, matchIssueUrl, showId } from './core.js';
export { github, redmine, timehuddle };

/** Every source definition, by kind. */
export const SOURCES = Object.freeze({ timehuddle, redmine, github });

/**
 * The kinds an owner can register a server as: connected with a key, and not
 * fixed to its own hosts. GitHub isn't one: it is built in, the same for every org.
 */
export const SERVER_TYPES = Object.freeze(
  Object.values(SOURCES)
    .filter((source) => source.connect.fields && !source.id.hosts)
    .map((source) => source.kind),
);

/** Whether `kind` is a source outside TimeHuddle, whose issues a ticket carries. */
export function isOutsideSource(kind) {
  return Object.hasOwn(SOURCES, kind) && SOURCES[kind] !== timehuddle;
}

/** Whether `kind` offers the member its issues as suggestions in the search bar. */
export function suggestsIssues(kind) {
  return Object.hasOwn(SOURCES, kind) && Boolean(SOURCES[kind].can.suggest);
}

/** What `kind` is called in the app, or null for a kind TimeHuddle doesn't know. */
export function sourceLabel(kind) {
  return Object.hasOwn(SOURCES, kind) ? SOURCES[kind].label : null;
}

/**
 * The outside ID for `url` (#689): `<repo>-<number>` for a GitHub issue or
 * pull request, `<prefix>-<number>` for an issue on a server the org has
 * registered in `prefixes` (`{ host, prefix, type }[]`), or null.
 */
export function outsideIdOf(url, prefixes) {
  return outsideIdOfWith(SOURCES, url, prefixes);
}
