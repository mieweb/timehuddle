import { useEffect, useState } from 'react';

import { ticketApi, type TicketLinkStatus } from '../../../lib/api';

/**
 * A ticket's link status, read each time `enabled` turns on (a dialog opening).
 * Null while it loads, and when it could not be read — the warnings it feeds are
 * advice, so a failed read hides them rather than blocking the change.
 */
export function useLinkStatus(ticketId: string, enabled: boolean): TicketLinkStatus | null {
  const [status, setStatus] = useState<TicketLinkStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus(null);
    ticketApi.linkStatus(ticketId).then(
      (next) => !cancelled && setStatus(next),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [ticketId, enabled]);

  return status;
}
