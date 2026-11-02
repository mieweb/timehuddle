/**
 * useHuddleViewing — tell the server this user has `teamId`'s Huddle open
 * (#784), so a push about that team can be skipped while they're looking at
 * it. Holds the no-data `huddle.viewing` subscription only while the tab is
 * visible; hiding the tab, switching team or leaving the page drops it.
 */
import { useEffect, useState } from 'react';

import { getDdpClient } from '@lib/ddp';

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export function useHuddleViewing(teamId: string | null): void {
  const visible = usePageVisible();
  useEffect(() => {
    if (!teamId || !visible) return;
    return getDdpClient().subscribe('huddle.viewing', [teamId]);
  }, [teamId, visible]);
}
