/**
 * Tells the member when Redmine rejected their saved API key (#734): once per
 * rejection, on whatever page they're on, with a way to Settings →
 * Integrations to paste their current key. A key reset in Redmine otherwise
 * just stops working, with nothing saying why.
 *
 * Renders nothing; mounted once in AppLayout.
 */
import { useToast } from '@mieweb/ui';
import { useEffect, useRef } from 'react';

import { useRedmineStatus } from '../../../lib/useRedmineStatus';
import { useRouter } from '../../../ui/router';
import { ticketLinkText } from '../link/ticketLinkStrings';

/** Where Settings shows the Redmine connection. */
export const REDMINE_SETTINGS_PATH = '/app/settings?section=integrations';

export function RedmineKeyRejectedToast() {
  const status = useRedmineStatus();
  const { navigate } = useRouter();
  const toast = useToast();
  const shown = useRef(false);

  useEffect(() => {
    // Reconnecting clears it, so a later rejection is told again.
    if (!status?.rejected) {
      shown.current = false;
      return;
    }
    if (shown.current) return;
    shown.current = true;
    toast.error(ticketLinkText.keyRejected, {
      title: ticketLinkText.keyRejectedTitle,
      duration: 0,
      action: {
        label: ticketLinkText.openSettings,
        onClick: () => navigate(REDMINE_SETTINGS_PATH),
      },
    });
  }, [status?.rejected, toast, navigate]);

  return null;
}
