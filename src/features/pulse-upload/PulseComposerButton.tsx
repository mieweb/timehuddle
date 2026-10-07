/**
 * PulseComposerButton — the Pulse button inside a post composer (the Huddle
 * message box, the Clock page's plan and wrap-up). It reserves a *library*
 * video; when PulseVault reports it landed, the video joins the composer as an
 * attachment to send with the post, and the button starts afresh.
 *
 * While a link is waiting, the composer holds its post for the video (see
 * `onWaitingChange`), and the chip offers to stop waiting. Nothing is kept
 * across a reload: a video that lands after that is in the uploader's media
 * library, not lost — the modal says so in the composer's own words.
 */
import React, { useEffect, useRef } from 'react';

import { pulseVideoMediaItem } from '../huddle/api';
import type { MediaItem } from '../huddle/types';
import { PulseChip } from './PulseButton';
import { COMPOSER_COPY } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload } from './usePulseUpload';

interface PulseComposerButtonProps {
  /** The landed video, as a composer attachment. */
  onAttach: (media: MediaItem) => void;
  /**
   * Whether a video may still arrive here: from the reserve request, through
   * the wait, until a landed video has been handed to `onAttach`. The composer
   * holds its post while it is true, so the video can't miss the post.
   */
  onWaitingChange?: (waiting: boolean) => void;
  disabled?: boolean;
}

export const PulseComposerButton: React.FC<PulseComposerButtonProps> = ({
  onAttach,
  onWaitingChange,
  disabled,
}) => {
  const onAttachRef = useRef(onAttach);
  onAttachRef.current = onAttach;
  const pulse = usePulseUpload(
    { kind: 'library' },
    {
      onSettled: (status, link) => {
        if (status.state === 'done') onAttachRef.current(pulseVideoMediaItem(link.videoid));
        // The attachment chip is the news now; a kept or expired link has said its piece.
        if (status.state === 'done') pulse.reset();
      },
    },
  );

  // Not only `waiting`: a link being reserved has no status yet, and a landed
  // one stays `done` while the modal shows it, until `reset()` after the attach.
  const waiting =
    pulse.reserving || pulse.status?.state === 'waiting' || pulse.status?.state === 'done';
  const onWaitingChangeRef = useRef(onWaitingChange);
  onWaitingChangeRef.current = onWaitingChange;
  useEffect(() => {
    onWaitingChangeRef.current?.(waiting);
  }, [waiting]);
  // Unmounting with a link waiting must not leave the host holding its post.
  useEffect(() => () => onWaitingChangeRef.current?.(false), []);

  return (
    <div className="pulse-upload flex flex-wrap items-center gap-2">
      <PulseChip
        pulse={pulse}
        ariaLabel="Record a video with Pulse"
        copy={COMPOSER_COPY}
        onCancel={pulse.reset}
        disabled={disabled}
      />
      <PulseUploadModal
        open={pulse.modalOpen}
        onClose={pulse.closeModal}
        scanLink={pulse.link?.scanLink ?? null}
        destination={pulse.destination}
        copy={COMPOSER_COPY}
        status={pulse.status}
      />
    </div>
  );
};
