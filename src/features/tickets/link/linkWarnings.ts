/**
 * What a user is told before they change a ticket's link.
 *
 * Time is recorded in TimeHuddle first and remembers the Redmine issue the
 * ticket was linked to when it was logged, so a link change never moves time
 * that already exists. These warnings say what that means for the person about
 * to make the change: their own figures, and that teammates will be told.
 */
import type { TicketLinkStatus } from '../../../lib/api';
import { formatDuration } from '../../../lib/timeUtils';

import { ticketLinkText } from './ticketLinkStrings';

export type LinkChange = 'link' | 'relink' | 'unlink';

/** The warnings for a link change, in the order to show them. Empty when there are none. */
export function linkWarnings(
  status: Pick<TicketLinkStatus, 'myTime' | 'othersWithTime'>,
  change: LinkChange,
  /** The issue the ticket is linked to now, e.g. `#482`. Unused for a first link. */
  currentRef: string,
): string[] {
  const { unlinkedSeconds, unsentSeconds, sentSeconds } = status.myTime;
  const warnings: string[] = [];

  if (change === 'link') {
    if (unlinkedSeconds > 0) {
      warnings.push(ticketLinkText.warnEarlierTime(formatDuration(unlinkedSeconds)));
    }
  } else {
    if (unsentSeconds > 0) {
      warnings.push(ticketLinkText.warnUnsent(formatDuration(unsentSeconds), currentRef));
    }
    if (sentSeconds > 0) {
      warnings.push(ticketLinkText.warnSent(formatDuration(sentSeconds), currentRef));
    }
    if (change === 'relink') warnings.push(ticketLinkText.warnFutureTime);
  }

  if (status.othersWithTime > 0) {
    warnings.push(ticketLinkText.warnTeammates(status.othersWithTime));
  }
  return warnings;
}
