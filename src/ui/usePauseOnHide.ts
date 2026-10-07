/**
 * usePauseOnHide — stop media when its page is hidden behind another.
 *
 * A kept page (see ROUTING.md) is hidden by <Activity>, which keeps its DOM, so
 * a playing <video> or <audio> would carry on, audible, behind the next page.
 * Layout-effect cleanups run on hide, so this pauses every element it is given.
 *
 * Returns a callback ref for each element to pause. It works for media that
 * mounts later (in a dialog) or in a portal, outside the page's own DOM.
 */
import { useCallback, useLayoutEffect, useState } from 'react';

export function usePauseOnHide(): (media: HTMLMediaElement | null) => () => void {
  const [mounted] = useState(() => new Set<HTMLMediaElement>());

  useLayoutEffect(() => () => mounted.forEach((media) => media.pause()), [mounted]);

  return useCallback(
    (media: HTMLMediaElement | null) => {
      if (media) mounted.add(media);
      return () => {
        if (media) mounted.delete(media);
      };
    },
    [mounted],
  );
}
