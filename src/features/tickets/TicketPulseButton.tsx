/**
 * TicketPulseButton — the Pulse button on a ticket's row (My Board and the
 * ticket lists), so a video for any ticket on the list is one press away: it
 * opens Pulse for that ticket, as the ticket page's Videos section does, and
 * the video lands among the ticket's videos. In the app with Pulse built in
 * it is the "Record with Pulse" glyph, which opens Pulse's recorder at once;
 * elsewhere it is today's Pulse chip (the link, or the QR code on a computer).
 *
 * Every ticket takes a Pulse video (H5), whichever system its work is
 * tracked in: a ticket linked to a Redmine issue or a GitHub issue is still a
 * TimeHuddle ticket. Only a row that isn't a TimeHuddle ticket at all has
 * nowhere for a video to land (`pulseTicketOf`).
 */
import React, { useEffect, useRef, useState } from 'react';

import { PulseRecordButton } from '../pulse-embed/PulseRecordButton';
import { PulseButton } from '../pulse-upload/PulseButton';
import type { UnifiedTicket } from './sources';

const text = {
  pulse: (title: string) => `Record a video for ${title} with Pulse`,
};

/** The TimeHuddle ticket a row's video goes to, and the team whose Pulse settings apply. */
export interface PulseTicket {
  ticketId: string;
  teamId: string | null;
}

/**
 * The ticket a row's Pulse video lands on, or null when the row isn't a
 * TimeHuddle ticket. A TimeHuddle row is one whatever its link (a Redmine or a
 * GitHub issue): its id is the ticket's. Another source's row has only that
 * system's issue number, which no ticket is (a Redmine issue reaches the list
 * through the ticket linked to it, #736).
 */
export function pulseTicketOf(
  ticket: Pick<UnifiedTicket, 'sourceId' | 'id' | 'container'>,
): PulseTicket | null {
  if (ticket.sourceId !== 'huddle' || !ticket.id) return null;
  return { ticketId: ticket.id, teamId: ticket.container?.id ?? null };
}

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

export const TicketPulseButton: React.FC<{
  ticketId: string;
  title: string;
  /** The ticket's team, whose "Pulse in the app" setting applies. */
  teamId?: string | null;
}> = ({ ticketId, title, teamId = null }) => {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>(ON_SCREEN_DWELL_MS);
  return (
    // The QR window and the pre-prompt are portaled out of the row, but their
    // clicks still bubble to the row through React, and the row opens its
    // ticket on a click.
    <div
      ref={ref}
      // No margin of its own: it sits in the row's ButtonGroup, whose gap spaces it.
      className="ticket-row-pulse inline-flex"
      onClick={(e) => e.stopPropagation()}
    >
      <PulseRecordButton
        place={{ type: 'ticket.video', ticketId, label: title }}
        teamId={teamId}
        // The size of the row's other icon buttons.
        buttonClassName="h-8 w-8"
        fallback={
          <PulseButton
            destination={{ kind: 'ticket', id: ticketId }}
            ariaLabel={text.pulse(title)}
            // One button per row: a phone has a link ready (so one tap opens
            // Pulse) only for the rows it has stopped on, not for the whole list.
            prepare={onScreen}
            // The Pulse logo alone, as the row's other actions are icons.
            compact="always"
          />
        }
      />
    </div>
  );
};
