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

/** The control's starting state for changing an existing ticket's link. */
export function linkFormFor(ticket: Pick<Ticket, 'github' | 'linkedIssue'>): LinkFormState {
  return { ...EMPTY_LINK_FORM, kind: linkKindOf(ticket), github: ticket.github };
}

/** Whether the choice is complete enough to save. */
export function linkFormReady(form: LinkFormState): boolean {
  if (form.kind === 'github') return form.github.trim().length > 0;
  if (form.kind === 'redmine') {
    return form.redmineMode === 'existing' ? form.issue !== null : form.projectId !== '';
  }
  return true;
}
