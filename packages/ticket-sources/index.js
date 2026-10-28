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
 * The outside ID for `url` (#689): `<repo>-<number>` for a GitHub issue or
 * pull request, `<prefix>-<number>` for an issue on a server the org has
 * registered in `prefixes` (`{ host, prefix, type }[]`), or null.
 */
export function outsideIdOf(url, prefixes) {
  return outsideIdOfWith(SOURCES, url, prefixes);
}
