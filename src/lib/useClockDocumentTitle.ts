/**
 * useClockDocumentTitle — Sync document.title with clock-in state.
 *
 * When clocked in, the tab title shows live elapsed time (e.g. "01:23:45 · Dashboard · TimeHuddle").
 * When not clocked in, it shows the page title only (e.g. "Dashboard · TimeHuddle").
 * On unmount, resets to the default static title.
 */
import { useEffect } from 'react';

import { useTeam } from './TeamContext';
import { formatTimer, getActiveClockSeconds } from './timeUtils';

const DEFAULT_TITLE = 'TimeHuddle — Team Time Tracking';

export function useClockDocumentTitle(pageTitle: string): void {
  const { activeClockEvent, currentTime } = useTeam();

  useEffect(() => {
    if (activeClockEvent) {
      const elapsed = getActiveClockSeconds(activeClockEvent, currentTime);
      document.title = `${formatTimer(elapsed)} · ${pageTitle} · TimeHuddle`;
    } else {
      document.title = `${pageTitle} · TimeHuddle`;
    }
  }, [activeClockEvent, currentTime, pageTitle]);

  useEffect(() => {
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, []);
}
