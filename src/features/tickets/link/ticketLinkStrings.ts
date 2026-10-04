/**
 * User-facing text for linking a TimeHuddle ticket to an external issue.
 *
 * Kept in one module, like `../ticketRemovalStrings.ts`, as the seam a
 * translation library will plug into. Anything built from a value is a
 * function so a translation can place it.
 */
export const ticketLinkText = {
  cardTitle: 'Linked issue',
  notLinked: 'Not linked to an external issue.',
  connect: 'Connect to…',
  change: 'Change',
  changeLinked: 'Change linked issue…',
  unlink: 'Unlink',
  redmine: 'Redmine',
  unassigned: 'Unassigned',
  loadingIssue: 'Loading the linked issue from Redmine',
  openIssue: (ref: string) => `Open Redmine issue ${ref}`,
  assignedTo: (name: string) => `Assigned to ${name}`,
  linkedTo: (ref: string) => `Linked to Redmine ${ref}`,
  linkedToWithStatus: (ref: string, status: string) => `Linked to Redmine ${ref} · ${status}`,
  notConnected: 'Connect your Redmine account in Settings to see this issue.',
  issueUnavailable: "You can't see this issue in Redmine, or it no longer exists.",
  goToSettings: 'Go to Settings',

  dialogTitle: 'Connect to an external issue',
  dialogTitleChange: 'Change the linked issue',
  tabsLabel: 'Where to connect this ticket',
  tabExisting: 'Existing Redmine issue',
  tabNew: 'New Redmine issue',
  tabGithub: 'GitHub link',
  replaces: (ref: string) => `This replaces the link to Redmine ${ref}.`,

  existingLabel: 'Redmine issue number or link',
  existingPlaceholder: '#1234 or a Redmine issue link',
  find: 'Find issue',
  finding: 'Finding…',
  needNumberOrLink: 'Enter an issue number or paste a link to a Redmine issue.',
  notFound: 'No issue found. It may not exist, or you may not have access to it.',
  alreadyLinked: 'This ticket is already linked to that issue.',
  previewLabel: 'Issue to link',
  linkTo: (ref: string) => `Link to ${ref}`,
  linking: 'Linking…',

  newIntro:
    'Create a new issue in Redmine from this ticket. Its title, description and priority are filled in for you; you choose the project and tracker.',
  newAction: 'Create in Redmine…',
  createdNotLinked: (ref: string) =>
    `Redmine issue ${ref} was created, but linking it to this ticket failed.`,
  retryLink: 'Try linking again',

  githubLabel: 'GitHub URL',
  githubPlaceholder: 'https://github.com/…',
  githubHelp: 'Leave empty to remove the link.',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  close: 'Close',

  redmineNeeded: 'Connect your Redmine account in Settings to link a Redmine issue.',
  linkFailed: "Couldn't link the issue. Please try again.",
  staleLink: 'Someone else changed this ticket’s link. Reload the ticket and try again.',

  unlinkTitle: (ref: string) => `Unlink Redmine issue ${ref}?`,
  unlinkBody:
    'The ticket stays in TimeHuddle and carries on as a plain ticket. Nothing changes in Redmine.',
  unlinking: 'Unlinking…',

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
  unlinkFailed: "Couldn't unlink the issue. Please try again.",
  loadFailed: 'Could not load the ticket. Please try again.',
  saveFailed: "Couldn't save the ticket. Please try again.",
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
