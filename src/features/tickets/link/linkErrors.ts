import { ApiError } from '../../../lib/api';

import { ticketLinkText } from './ticketLinkStrings';

/** The user-facing message for a refused link or unlink. */
export function linkErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === 'stale-link') return ticketLinkText.staleLink;
  if (err.code === 'not-connected') return ticketLinkText.redmineNeeded;
  if (err.code === 'issue-unavailable') return ticketLinkText.notFound;
  // Other refusals carry the server's own explanation.
  return err.message || fallback;
}
