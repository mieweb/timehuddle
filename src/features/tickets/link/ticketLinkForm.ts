/**
 * The state behind the one control for a ticket's link: a link to anything,
 * which may stand for the issue it names, or a Redmine issue (an existing one,
 * or a new one created from the ticket). The create dialog and the ticket
 * page's "Linked issue" section share it, so the choice reads the same in both.
 */
import { matchIssueUrl, outsideIdOf, redmine, type SourceServer } from '@timehuddle/ticket-sources';

import type { RedmineIssue, Ticket } from '../../../lib/api';

export type LinkKind = 'none' | 'github' | 'redmine';
export type RedmineMode = 'existing' | 'new';

export interface LinkFormState {
  /** `github`: the link field. `redmine`: the Redmine issue panel. */
  kind: Exclude<LinkKind, 'none'>;
  /** The link: any https address. Empty for none. */
  github: string;
  /** "Convert to … issue" was chosen: the ticket goes by the ID the link names. */
  linkIsIssue: boolean;
  redmineMode: RedmineMode;
  /** What was typed to find an existing issue. Never stored: it may be a patient's name. */
  query: string;
  /** The existing issue found and previewed, ready to link. */
  issue: RedmineIssue | null;
  /** For a new issue. Everything else about it comes from the ticket. */
  projectId: string;
  trackerId: string;
}

export const EMPTY_LINK_FORM: LinkFormState = {
  kind: 'github',
  github: '',
  linkIsIssue: false,
  redmineMode: 'existing',
  query: '',
  issue: null,
  projectId: '',
  trackerId: '',
};

/** What a ticket's current link is, as the kind the control shows selected. */
export function linkKindOf(ticket: Pick<Ticket, 'github' | 'linkedIssue'>): LinkKind {
  if (ticket.linkedIssue) return 'redmine';
  return ticket.github ? 'github' : 'none';
}

/**
 * The control's starting state for changing an existing ticket's link. A link
 * saved before the convert choice existed went by its issue's ID, so it keeps it.
 */
export function linkFormFor(
  ticket: Pick<Ticket, 'github' | 'linkIsIssue' | 'linkedIssue'>,
): LinkFormState {
  return {
    ...EMPTY_LINK_FORM,
    kind: ticket.linkedIssue ? 'redmine' : 'github',
    github: ticket.github,
    linkIsIssue: ticket.linkIsIssue ?? true,
  };
}

/**
 * The ID a link would give its ticket if converted, e.g. `pulse-250` or
 * `PM-233`, or null when it names no issue the org knows.
 */
export function convertibleIdOf(link: string, servers: readonly SourceServer[]): string | null {
  return isHttpsUrl(link) ? outsideIdOf(link.trim(), servers) : null;
}

/**
 * Whether `value` is an absolute `https://` URL — the only kind of external
 * link that is saved. The link is stored for a team and rendered as an `href`
 * for every member, so `javascript:`, `data:` and plain `http://` are refused.
 * Any host is allowed. The server makes the same check.
 */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Whether `value` is an issue on the Redmine server at `redmineBaseUrl`. That
 * is linked as a Redmine issue, so the ticket shows its status and history.
 */
export function isRedmineIssueUrl(
  value: string,
  redmineBaseUrl: string | null | undefined,
): boolean {
  if (!redmineBaseUrl) return false;
  try {
    const url = new URL(value.trim());
    return (
      url.hostname === new URL(redmineBaseUrl).hostname && matchIssueUrl(redmine, url.href) !== null
    );
  } catch {
    return false;
  }
}

/**
 * Whether a stored link is safe to render as an `href`. Wider than what can be
 * saved now, so links saved before the https rule (plain `http://`) still open.
 */
export function isWebUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value.trim()).protocol);
  } catch {
    return false;
  }
}

/**
 * Whether the choice is complete enough to save. An empty link is no link: fine
 * for a new ticket, but not when changing one, where removing it is "Unlink".
 */
export function linkFormReady(form: LinkFormState, { allowNone = true } = {}): boolean {
  if (form.kind === 'github') {
    return form.github.trim() ? isHttpsUrl(form.github) : allowNone;
  }
  if (form.kind === 'redmine') {
    return form.redmineMode === 'existing' ? form.issue !== null : form.projectId !== '';
  }
  return true;
}
