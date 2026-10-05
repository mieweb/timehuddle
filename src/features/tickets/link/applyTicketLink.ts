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

/**
 * A Redmine link was removed to make way for a GitHub one, which then could not
 * be saved. `ticket` is the ticket as it now stands, without a link.
 */
export class LinkRemovedNotReplacedError extends Error {
  constructor(
    readonly ticket: Ticket,
    readonly cause: unknown,
  ) {
    super('The Redmine link was removed, but the GitHub link could not be saved.');
    this.name = 'LinkRemovedNotReplacedError';
  }
}

/** What a new issue is made with when the project's options cannot be read. */
const NO_OPTIONS = { assignees: [], priorities: [], defaultPriorityId: null, me: null };

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
  // The options only refine the issue. Without them Redmine applies its own
  // defaults, which is what the form promised when it let this through.
  const options = await redmineApi.projects.formOptions(projectId).catch(() => NO_OPTIONS);
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
  const unlinked = linkedId ? await ticketApi.unlink(ticket.id, linkedId) : null;
  if (github === ticket.github) return unlinked;
  try {
    return await ticketApi.updateTicket(ticket.id, { github });
  } catch (err) {
    // The two steps are separate calls. The first one stands, so say so.
    if (unlinked) throw new LinkRemovedNotReplacedError(unlinked, err);
    throw err;
  }
}
