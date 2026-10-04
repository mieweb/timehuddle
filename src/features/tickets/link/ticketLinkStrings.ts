/**
 * User-facing text for linking a TimeHuddle ticket to an external issue.
 *
 * Kept in one module, like `../ticketRemovalStrings.ts`, as the seam a
 * translation library will plug into. Anything built from a value is a
 * function so a translation can place it.
 */
export const ticketLinkText = {
  sectionTitle: 'Linked Issue',
  notLinked: 'Not linked. This ticket is tracked in TimeHuddle only.',
  add: 'Add link',
  change: 'Change',
  remove: 'Unlink',
  from: 'from',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  redmine: 'Redmine',
  github: 'GitHub',
  loadingIssue: 'Loading the linked issue from Redmine',
  openIssue: (ref: string) => `Open issue ${ref} in Redmine`,
  openGithub: (url: string) => `Open GitHub link ${url}`,
  /** "New · Assigned to Grace Oduya" — the live facts about the linked issue, as quiet text. */
  statusAndAssignee: (status: string | null, assignee: string | null) =>
    [status, assignee ? `Assigned to ${assignee}` : 'Unassigned'].filter(Boolean).join(' · '),
  linkedTo: (ref: string) => `Linked to Redmine ${ref}`,
  linkedToWithStatus: (ref: string, status: string) => `Linked to Redmine ${ref} · ${status}`,
  notConnected: 'Connect your Redmine account in Settings to see this issue.',
  issueUnavailable: "You can't see this issue in Redmine, or it no longer exists.",
  goToSettings: 'Go to Settings',

  kindLabel: 'Tracked in',
  kindNone: 'TimeHuddle',
  kindGithub: 'GitHub',
  kindRedmine: 'Redmine',

  githubLabel: 'GitHub issue or pull request link',
  githubPlaceholder: 'https://github.com/…',

  redmineModeLabel: 'Redmine issue',
  modeExisting: 'Existing issue',
  modeNew: 'New issue',
  existingLabel: 'Issue number or link',
  existingPlaceholder: '#1234 or a Redmine issue link',
  find: 'Find',
  finding: 'Finding…',
  needNumberOrLink: 'Enter an issue number or paste a link to a Redmine issue.',
  notFound: 'No issue found. It may not exist, or you may not have access to it.',
  previewLabel: 'Issue to link',
  projectLabel: 'Project',
  projectPlaceholder: 'Choose a project',
  trackerLabel: 'Tracker',
  loadingProjects: 'Loading your Redmine projects',
  newIssueHelp:
    "The issue gets this ticket's title, description and priority, and is assigned to you.",

  redmineNeeded: 'Connect your Redmine account in Settings to link a Redmine issue.',
  linkFailed: "Couldn't save the link. Please try again.",
  staleLink: 'Someone else changed this ticket’s link. Reload the ticket and try again.',
  createdNotLinked: (ref: string) =>
    `Redmine issue ${ref} was created, but linking it to this ticket failed. Save again to link it.`,
  ticketCreatedLinkFailed: (reason: string) =>
    `The ticket was created, but it could not be linked: ${reason} Open the ticket to try again.`,
  openTicketToLink: 'Open the ticket to link it.',

  removeConfirm:
    'Unlink this issue? The ticket stays in TimeHuddle, and nothing changes in the linked system.',
  removeAction: 'Unlink',
  removing: 'Unlinking…',
  saveFailed: "Couldn't save the ticket. Please try again.",

  warnUnsent: (duration: string, ref: string) =>
    `${duration} you logged on this ticket hasn't been sent to Redmine ${ref} yet. It stays with ${ref}: you can still send it from the Clock page, or choose "Never send" there.`,
  warnSent: (duration: string, ref: string) =>
    `${duration} you already sent stays on Redmine ${ref}.`,
  warnFutureTime: 'Time you log from now on goes to the new issue.',
  warnEarlierTime: (duration: string) =>
    `You've already logged ${duration} on this ticket. That time stays in TimeHuddle; only time logged from now on can be sent to Redmine.`,
  warnTeammates: (count: number) =>
    count === 1
      ? '1 teammate who logged time on this ticket will be notified.'
      : `${count} teammates who logged time on this ticket will be notified.`,
};

/** The `action` values a link change is recorded under in a ticket's activity. */
const LINK_ACTIVITY_LABELS: Record<string, string> = {
  linked: 'Linked ticket',
  relinked: 'Changed linked issue',
  unlinked: 'Unlinked ticket',
};

/** The activity-feed label for a link change, or null for any other action. */
export function linkActivityLabel(action: unknown): string | null {
  return typeof action === 'string' ? (LINK_ACTIVITY_LABELS[action] ?? null) : null;
}

/**
 * The sentence after the actor's name on the ticket's own timeline for a link
 * change, or null for any other event. The payload carries issue ids only.
 */
export function linkActivitySentence(payload: Record<string, unknown>): string | null {
  const ref = (id: unknown) =>
    typeof id === 'string' && id ? `Redmine #${id}` : 'a Redmine issue';
  switch (payload.action) {
    case 'linked':
      return `linked this ticket to ${ref(payload.issueId)}`;
    case 'relinked':
      return `moved this ticket's link from ${ref(payload.previousIssueId)} to ${ref(payload.issueId)}`;
    case 'unlinked':
      return `unlinked this ticket from ${ref(payload.previousIssueId)}`;
    default:
      return null;
  }
}
