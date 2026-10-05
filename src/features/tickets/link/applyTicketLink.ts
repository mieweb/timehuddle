/**
 * Makes a ticket's link match what was chosen in the link control.
 *
 * A ticket has one link, so each choice replaces whatever was there. Removing a
 * Redmine link always goes through `tickets.unlink`: that is the call that
 * respects the lock and tells teammates who logged time on the ticket.
 */
import { redmineApi, ticketApi, type RedmineIssue, type Ticket } from '../../../lib/api';
import { matchPriorityId, mismatchWarning, prefillFromTicket } from '../redmine/redmineForm';

import type { LinkFormState } from './ticketLinkForm';

/** The ticket fields a link change reads: its current link, and what a new issue is made from. */
export type LinkableTicket = Pick<
  Ticket,
  'id' | 'title' | 'description' | 'priority' | 'github' | 'linkedIssue'
>;

/**
 * A new Redmine issue was created but the ticket could not be linked to it.
 * The issue exists whatever happens next, so the caller offers to link it
 * rather than create a second one.
 */
export class IssueCreatedNotLinkedError extends Error {
  constructor(
    readonly issue: RedmineIssue,
    readonly cause: unknown,
  ) {
    super(`Redmine issue #${issue.id} was created, but linking it to this ticket failed.`);
    this.name = 'IssueCreatedNotLinkedError';
  }
}

/** Told when a step succeeded with something the user should know. */
export interface LinkOutcome {
  /** Redmine stored the new issue differently from what was sent. */
  onWarning?: (message: string) => void;
}

/** Create a Redmine issue from the ticket: its title, description and priority, assigned to the caller. */
async function createIssueFrom(
  ticket: LinkableTicket,
  form: LinkFormState,
  { onWarning }: LinkOutcome,
): Promise<RedmineIssue> {
  const projectId = Number(form.projectId);
  const options = await redmineApi.projects.formOptions(projectId);
  const prefill = prefillFromTicket(ticket);
  const meIsMember = options.assignees.some((member) => member.id === options.me);
  const created = await redmineApi.issues.create({
    projectId,
    subject: prefill.subject,
    description: prefill.description,
    trackerId: form.trackerId ? Number(form.trackerId) : null,
    priorityId: matchPriorityId(options.priorities, prefill.priority) ?? options.defaultPriorityId,
    assigneeId: meIsMember ? options.me : null,
  });
  const warning = mismatchWarning(created.mismatches ?? []);
  if (warning) onWarning?.(warning);
  // The read-back can fail after a create that succeeded; the number is still good.
  return (
    created.issue ?? {
      id: created.issueId,
      subject: prefill.subject,
      project: null,
      status: null,
      assignedTo: null,
      priority: null,
      tracker: null,
      createdAt: null,
      updatedAt: null,
    }
  );
}

/**
 * Apply the chosen link to an existing ticket.
 * @returns the ticket as the server stored it, or null when nothing had to change
 */
export async function applyTicketLink(
  ticket: LinkableTicket,
  form: LinkFormState,
  outcome: LinkOutcome = {},
): Promise<Ticket | null> {
  const linkedId = ticket.linkedIssue?.id ?? null;

  if (form.kind === 'redmine') {
    if (form.redmineMode === 'existing') {
      if (!form.issue || String(form.issue.id) === linkedId) return null;
      return ticketApi.link(ticket.id, form.issue.id, linkedId);
    }
    const issue = await createIssueFrom(ticket, form, outcome);
    try {
      return await ticketApi.link(ticket.id, issue.id, linkedId);
    } catch (err) {
      throw new IssueCreatedNotLinkedError(issue, err);
    }
  }

  const github = form.kind === 'github' ? form.github.trim() : '';
  let updated: Ticket | null = null;
  if (linkedId) updated = await ticketApi.unlink(ticket.id, linkedId);
  if (github !== ticket.github) updated = await ticketApi.updateTicket(ticket.id, { github });
  return updated;
}
