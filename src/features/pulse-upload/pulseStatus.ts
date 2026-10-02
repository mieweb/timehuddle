import type { PulseDestination } from '../../lib/api';

/** What a delivered Pulse video did, by where it was sent. */
const LANDED_LABELS: Record<PulseDestination['kind'], string> = {
  huddle: 'Posted to Huddle',
  'clock-plan': "Plan posted — you're clocked in",
  'clock-wrapup': "Wrap-up posted — you're clocked out",
  ticket: 'Added',
  clock: 'Added',
  'timesheet-request': 'Walkthrough added — the approver will see it',
};

export function landedLabel(destination: PulseDestination): string {
  return LANDED_LABELS[destination.kind];
}

/**
 * What to tell someone whose Pulse video couldn't go where they recorded it
 * for: the server kept it instead (never thrown away),
 * and `reason` says why — e.g. the change was reviewed while they recorded.
 */
export function keptMessage(reason?: string): string {
  // Server reasons aren't always full sentences ("Not a team member").
  const why = reason ? ` ${reason.replace(/\.?$/, '.')}` : '';
  return `Couldn't add your video here.${why} It's saved, not lost.`;
}
