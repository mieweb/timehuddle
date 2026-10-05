/**
 * The state behind the one control that says where a ticket is tracked:
 * TimeHuddle only, a GitHub link, or a Redmine issue (an existing one, or a new
 * one created from the ticket). The create dialog and the ticket page's
 * "Linked issue" section share it, so the choice reads the same in both.
 */
import type { RedmineIssue, Ticket } from '../../../lib/api';

export type LinkKind = 'none' | 'github' | 'redmine';
export type RedmineMode = 'existing' | 'new';

export interface LinkFormState {
  kind: LinkKind;
  /** GitHub issue or pull request URL. */
  github: string;
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
  kind: 'none',
  github: '',
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
 * The control's starting state for changing an existing ticket's link. There
 * is no "TimeHuddle" choice there (a link is removed with Unlink), so a ticket
 * without a link starts on Redmine.
 */
export function linkFormFor(ticket: Pick<Ticket, 'github' | 'linkedIssue'>): LinkFormState {
  const kind = linkKindOf(ticket);
  return { ...EMPTY_LINK_FORM, kind: kind === 'none' ? 'redmine' : kind, github: ticket.github };
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

/** Whether the choice is complete enough to save. */
export function linkFormReady(form: LinkFormState): boolean {
  if (form.kind === 'github') return isHttpsUrl(form.github);
  if (form.kind === 'redmine') {
    return form.redmineMode === 'existing' ? form.issue !== null : form.projectId !== '';
  }
  return true;
}
