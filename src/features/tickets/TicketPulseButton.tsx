/**
 * TicketPulseButton — the Pulse chip on a Huddle ticket's row (My Board and
 * the ticket lists), so a video for any ticket on the list is one press away:
 * it opens Pulse for that ticket, as the ticket page's Videos section does,
 * and the video lands among the ticket's videos.
 *
 * Only Huddle tickets take a Pulse video (the `ticket` destination), so
 * TicketRow shows it for those alone.
 */
import React, { useEffect, useRef, useState } from 'react';

import { PulseButton } from '../pulse-upload/PulseButton';

const text = {
  pulse: (title: string) => `Record a video for ${title} with Pulse`,
};

/**
 * How long a row stays on screen before it counts as there: rows flicked past
 * on the way down a list never do, so nothing is prepared for them.
 */
const ON_SCREEN_DWELL_MS = 300;

/**
 * Whether the element has been in the viewport for `dwellMs` (true where that
 * can't be observed). False again the moment it leaves.
 */
function useOnScreen<T extends Element>(dwellMs: number): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [onScreen, setOnScreen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      // Several changes can arrive at once, oldest first: the last is where it is now.
      const visible = entries[entries.length - 1]?.isIntersecting ?? false;
      clearTimeout(dwell);
      if (visible) dwell = setTimeout(() => setOnScreen(true), dwellMs);
      else setOnScreen(false);
    });
    observer.observe(el);
    return () => {
      clearTimeout(dwell);
      observer.disconnect();
    };
  }, [dwellMs]);
  return [ref, onScreen];
}

export const TicketPulseButton: React.FC<{ ticketId: string; title: string }> = ({
  ticketId,
  title,
}) => {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>(ON_SCREEN_DWELL_MS);
  return (
    // The QR window is portaled out of the row, but its clicks still bubble to
    // the row through React, and the row opens its ticket on a click.
    <div
      ref={ref}
      className="ticket-row-pulse me-1 inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <PulseButton
        destination={{ kind: 'ticket', id: ticketId }}
        ariaLabel={text.pulse(title)}
        // One button per row: a phone has a link ready (so one tap opens
        // Pulse) only for the rows it has stopped on, not for the whole list.
        prepare={onScreen}
        // The Pulse logo alone, as the row's other actions are icons.
        compact="always"
      />
    </div>
  );
};
