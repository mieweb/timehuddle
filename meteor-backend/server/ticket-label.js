/**
 * How a ticket is named where its team reads it, in a timer's Huddle update
 * and on a post's tickets (#788): by the ID it leads with in the Tickets table
 * (#689) and its title. Pure: no Meteor, no database.
 */
import { outsideIdOf } from '@timehuddle/ticket-sources';

/** The ticket's own page in the app, where a reader with access sees the rest. */
export function ticketPath(source, ticketId) {
  return source === 'redmine' ? `/app/tickets/redmine/${ticketId}` : `/app/tickets/${ticketId}`;
}

/**
 * A Huddle ticket's own ID, e.g. `TH-12`; before it is numbered, the tail of
 * its id stands in, e.g. `#3fa2c` (`huddleTicketRef` in the app).
 */
export function huddleTicketRef(ticketId, number, ticketPrefix) {
  return number && ticketPrefix ? `${ticketPrefix}-${number}` : `#${String(ticketId).slice(-5)}`;
}

/**
 * The outside ID of the Redmine issue a ticket carries, e.g. `RMX-150`, or null
 * when its server has no prefix. A link with no host is on `redmineHost`, the
 * deployment's own Redmine (`carriedRefOf` in the app).
 */
function carriedRef(linkedIssue, sourcePrefixes, redmineHost) {
  const host = linkedIssue?.host ?? redmineHost;
  return linkedIssue && host
    ? outsideIdOf(`https://${host}/issues/${linkedIssue.id}`, sourcePrefixes)
    : null;
}

/**
 * How a Huddle ticket is named: the ID it leads with, as `leadingRefOf` in the
 * app (the issue it carries, else the issue its link names, else its own), and
 * its title.
 *
 * @param {{ _id: unknown, title?: string | null, number?: number, github?: string | null,
 *   linkIsIssue?: boolean, linkedIssue?: { id: string, host?: string } | null }} ticket
 * @param {{ ticketPrefix: string, sourcePrefixes: { host: string, prefix: string }[] }} ids
 *   the ticket's org's, from `ticketIdsFor`
 * @param {string | null} redmineHost the deployment's own Redmine host
 * @returns {{ ref: string, title: string | null, path: string }}
 */
export function huddleTicketLabel(ticket, { ticketPrefix, sourcePrefixes }, redmineHost) {
  const id = String(ticket._id);
  const own = huddleTicketRef(id, ticket.number, ticketPrefix);
  const link = ticket.linkIsIssue === false ? null : ticket.github;
  const ref =
    carriedRef(ticket.linkedIssue, sourcePrefixes, redmineHost) ??
    outsideIdOf(link, sourcePrefixes) ??
    own;
  return { ref, title: ticket.title ?? null, path: ticketPath('huddle', id) };
}

/**
 * How a bare Redmine issue (a work item from before #736) is named: by its
 * outside ID on the deployment's own Redmine, e.g. `RMX-200`, else `#200`. It
 * has no ticket, so no stored title to show.
 */
export function redmineIssueLabel(issueId, sourcePrefixes, redmineHost) {
  const ref =
    (redmineHost && outsideIdOf(`https://${redmineHost}/issues/${issueId}`, sourcePrefixes)) ||
    `#${issueId}`;
  return { ref, title: null, path: ticketPath('redmine', issueId) };
}

/** A label as one line of text: `TH-12: Fix login`, or the ID alone. */
export function ticketName({ ref, title }) {
  // One line: a title may hold line breaks, and a name is a single line.
  const oneLine = title?.replace(/\s+/g, ' ').trim();
  return oneLine ? `${ref}: ${oneLine}` : ref;
}
