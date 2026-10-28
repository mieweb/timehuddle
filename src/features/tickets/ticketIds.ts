/**
 * Outside IDs (#689): the short name an issue in another system goes by,
 * worked out from its address.
 *
 * - A GitHub issue or pull request is `<repo>-<number>`, e.g. `timehuddle-223`,
 *   with no setup.
 * - An address on a server the organization has named is `<prefix>-<number>`,
 *   e.g. `PM-233` for `https://redmine.example.com/issues/233`.
 *
 * Pure, so every surface names an issue the same way. How an address becomes
 * an ID lives in `@timehuddle/ticket-sources`, shared with the backend; the
 * helpers here are about ticket rows.
 */
import { outsideIdOf } from '@timehuddle/ticket-sources';

import type { SourcePrefix, Ticket } from '../../lib/api';

import type { UnifiedTicket } from './sources/types';

/** The outside ID for an address, from the shared ticket sources (#734). */
export { outsideIdOf };

/**
 * The outside ID a ticket's link gives it, e.g. `pulse-250`, or null. A link
 * saved as just a link (`linkIsIssue: false`) gives none: the ticket keeps its own.
 */
export function linkRefOf(
  ticket: Pick<Ticket, 'github' | 'linkIsIssue'>,
  prefixes: readonly SourcePrefix[],
): string | null {
  return ticket.linkIsIssue === false ? null : outsideIdOf(ticket.github, prefixes);
}

/**
 * The outside ID of the Redmine issue a ticket carries, e.g. `RMX-150`, or null
 * when its server has no prefix. A link with no host is on `redmineHost`, the
 * connected Redmine.
 */
export function carriedRefOf(
  linked: { id: string; host?: string } | null,
  prefixes: readonly SourcePrefix[],
  redmineHost: string | null,
): string | null {
  const host = linked?.host ?? redmineHost;
  return linked && host ? outsideIdOf(`https://${host}/issues/${linked.id}`, prefixes) : null;
}

/**
 * The outside ID a ticket goes by, when it has a named one: the issue it is
 * linked to (`RM0-214`), or the link it carries (`timehuddle-717`). Null for a
 * pure TimeHuddle ticket, and for an issue's own row, whose `ref` already is one.
 *
 * A linked issue the viewer can't read keeps a bare `#214`, which says nothing
 * of where it lives, so it never stands in for the ticket's own ID.
 */
export function outsideRefOf(ticket: UnifiedTicket): string | null {
  const linked = ticket.linked?.ref;
  return (linked && !linked.startsWith('#') ? linked : null) ?? ticket.externalRef?.id ?? null;
}

/** The ID a ticket is shown and sorted by: its outside one first, else its own. */
export function leadingRefOf(ticket: UnifiedTicket): string {
  return outsideRefOf(ticket) ?? ticket.ref;
}
