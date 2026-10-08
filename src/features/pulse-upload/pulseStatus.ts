import type { PulseDestination } from '../../lib/api';

/** What a delivered Pulse video did, by where it was sent. */
const LANDED_LABELS: Record<PulseDestination['kind'], string> = {
  library: 'Added to your media library',
  ticket: 'Added to this ticket',
  redmine: 'Added to this issue',
  clock: 'Added to this session',
  huddle: 'Posted to Huddle',
  // Exactly the backend's notes (pulse-destinations.js): a note that says
  // more is a step after delivery that failed, and is shown.
  'clock-plan': "Plan posted — you're clocked in",
  'clock-wrapup': "Wrap-up posted — you're clocked out",
};

export function landedLabel(destination: PulseDestination): string {
  return LANDED_LABELS[destination.kind];
}

/** Where a Pulse video goes once it uploads, said before recording. */
const UPLOAD_HINTS: Record<PulseDestination['kind'], string> = {
  library: "It's added to your media library as soon as it uploads.",
  ticket: "It's added to this ticket as soon as it uploads.",
  redmine: "It's added to this issue as soon as it uploads.",
  clock: "It's added to this session as soon as it uploads.",
  huddle: "It's posted to Huddle as soon as it uploads, with your draft's name as its text.",
  'clock-plan': "It's posted as your plan, and you're clocked in, as soon as it uploads.",
  'clock-wrapup': "It's posted as your wrap-up, and you're clocked out, as soon as it uploads.",
};

export function uploadHint(destination: PulseDestination): string {
  return UPLOAD_HINTS[destination.kind];
}

/**
 * What a delivered video's note adds to the landed label, if anything: the
 * backend says "Plan posted, but you weren't clocked in: …" when a step after
 * delivery failed, and the plain label when nothing did.
 */
export function followUpNote(destination: PulseDestination, note?: string): string {
  // Other kinds' notes are for logs ("Attached to ticket <id>"), not people.
  if (destination.kind !== 'clock-plan' && destination.kind !== 'clock-wrapup') return '';
  return note && note !== landedLabel(destination) ? note : '';
}

/** A link's token works for 30 minutes; after that, only a new one will do. */
export const EXPIRED_MESSAGE = 'This link has expired. Press Pulse again for a new one.';

/**
 * What to tell someone whose Pulse video couldn't go where they recorded it
 * for: the server kept it instead (never thrown away), and `reason` says why —
 * e.g. the ticket was deleted while they recorded.
 */
export function keptMessage(reason?: string): string {
  // Server reasons aren't always full sentences ("Not a team member").
  const why = reason ? ` ${reason.replace(/\.?$/, '.')}` : '';
  return `Couldn't add your video here.${why} It's saved, not lost.`;
}
