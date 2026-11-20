/**
 * What a session post says about a Pulse video sent with its clock action
 * (huddle-server §9.4, PLAN O14; TH-11): Clock out or Clock in with a Pulse
 * video posts the wrap-up line or the plan at Send, and the video follows.
 *
 *  - on its way (`pendingVideos`): "Video on its way";
 *  - still on its way 24 h after Send (the server's `overdueAt`): "Wrap-up
 *    video hasn't arrived yet" (or the plan's);
 *  - won't come (`missingVideos`: deleted, or its sending cancelled):
 *    "Wrap-up video didn't arrive" (or the plan's).
 *
 * There is no deadline (O14): a late video still attaches, and the server
 * clears every mark when it lands. `pulsePendingNote` is the words, for the
 * Huddle feed's label (superChatFeed.ts); `PulsePendingNote` shows them on a
 * page, announced as they change.
 */
import { Text, cn } from '@mieweb/ui';
import React from 'react';

import type { HuddlePost, PulseVideoMark } from '../../lib/api';
import { CLOCK_PULSE_TEXT } from '../pulse-embed/clockPulseStrings';

const T = CLOCK_PULSE_TEXT.note;

const roleOf = (mark: PulseVideoMark): 'plan' | 'wrapup' =>
  mark.role === 'plan' ? 'plan' : 'wrapup';

/**
 * Each thing a post has to say about its clock videos, once each: the ones
 * that won't come first, then those overdue, then "Video on its way". Empty
 * when it is waiting for none.
 */
export function pulsePendingNotes(
  post: Pick<HuddlePost, 'pendingVideos' | 'missingVideos'>,
): string[] {
  const notes: string[] = [];
  const add = (note: string) => {
    if (!notes.includes(note)) notes.push(note);
  };
  const pending = post.pendingVideos ?? [];
  for (const mark of post.missingVideos ?? []) add(T.missing(roleOf(mark)));
  for (const mark of pending) if (mark.overdueAt) add(T.overdue(roleOf(mark)));
  if (pending.some((mark) => !mark.overdueAt)) add(T.onItsWay);
  return notes;
}

/** A post's clock-video notes as one line ("Video on its way"); null when there are none. */
export function pulsePendingNote(
  post: Pick<HuddlePost, 'pendingVideos' | 'missingVideos'>,
): string | null {
  const notes = pulsePendingNotes(post);
  return notes.length > 0 ? notes.join(' · ') : null;
}

export interface PulsePendingNoteProps {
  post: Pick<HuddlePost, 'pendingVideos' | 'missingVideos'>;
  className?: string;
}

/** A post's clock-video note, announced politely; nothing when it waits for none. */
export const PulsePendingNote: React.FC<PulsePendingNoteProps> = ({ post, className }) => {
  const note = pulsePendingNote(post);
  // A video that is late or won't come needs the person; one on its way doesn't.
  const late =
    (post.missingVideos?.length ?? 0) > 0 || !!post.pendingVideos?.some((m) => m.overdueAt);
  // The live region stays mounted, so the note's arrival and clearing are announced.
  return (
    <div role="status" aria-live="polite" className={cn('pulse-pending-note', className)}>
      {note && (
        <Text variant={late ? 'warning' : 'muted'} size="sm" className="pulse-pending-note-text">
          {note}
        </Text>
      )}
    </div>
  );
};
