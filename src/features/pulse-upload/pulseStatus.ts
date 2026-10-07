import type { PulseDestination } from '../../lib/api';

/** What a delivered Pulse video did, by where it was sent. */
const LANDED_LABELS: Record<PulseDestination['kind'], string> = {
  library: 'Added to your media library',
  ticket: 'Added to this ticket',
  redmine: 'Added to this issue',
  clock: 'Added to this session',
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
};

export function uploadHint(destination: PulseDestination): string {
  return UPLOAD_HINTS[destination.kind];
}

/** The hint before recording and the line once the video has landed, when the
 * destination kind alone doesn't say it. */
export interface PulseCopy {
  hint: string;
  landed: string;
}

/**
 * A composer's Pulse button reserves a *library* video and attaches it to the
 * post being written, so it says that rather than "your media library".
 */
export const COMPOSER_COPY: PulseCopy = {
  hint: "It's attached to your post as soon as it uploads.",
  landed: 'Attached to your post',
};

/** Beside a composer's chip while its link is open and the modal is closed. */
export const WAITING_MESSAGE = 'Waiting for your Pulse video…';

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
