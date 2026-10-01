/**
 * PulseButton — the one way to add a video anywhere in TimeHuddle: a "Pulse"
 * pill that reserves an upload for a `destination`, then shows the QR code
 * (computer) or opens the Pulse app (phone). See {@link usePulseUpload}.
 *
 * `PulseButton` owns its upload. A host that swaps the button out while a
 * video may still be on its way calls `usePulseUpload` itself and renders
 * `PulseChip` and `PulseUploadModal` from it instead, so the watch and the
 * modal outlive the button.
 */
import { faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Text } from '@mieweb/ui';
import React from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { keptMessage } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** Accessible name; the visible label is "Pulse". */
  ariaLabel?: string;
  disabled?: boolean;
}

/** The Pulse pill, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({
  pulse,
  ariaLabel = 'Record a video with Pulse',
  disabled,
}) => {
  const { reserving, error, status, modalOpen } = pulse;
  // Phones have no modal: say it here when the video went elsewhere, or when
  // a step after delivery failed.
  const note = modalOpen
    ? ''
    : status?.state === 'kept'
      ? keptMessage(status.reason)
      : status?.state === 'done'
        ? (status.note ?? '')
        : '';
  return (
    <>
      <ComposerChipButton
        onClick={() => void pulse.start()}
        disabled={disabled || reserving}
        aria-label={reserving ? `${ariaLabel} (preparing…)` : ariaLabel}
        aria-busy={reserving}
        leftIcon={<FontAwesomeIcon icon={faVideo} className="w-3.5 h-3.5" aria-hidden="true" />}
      >
        {reserving ? 'Preparing…' : 'Pulse'}
      </ComposerChipButton>

      {error && (
        <Text as="span" size="xs" className="text-red-500 dark:text-red-400" role="alert">
          {error}
        </Text>
      )}
      {/* Mounted while there's a link, so the update is announced. */}
      {status && (
        <Text
          as="span"
          size="xs"
          variant="muted"
          role="status"
          className={note ? 'pulse-chip-status' : 'pulse-chip-status sr-only'}
        >
          {note}
        </Text>
      )}
    </>
  );
};

interface PulseButtonProps {
  destination: PulseDestination;
  ariaLabel?: string;
  /** Called once the video has landed: `done`, or `kept` in the library. */
  onSettled?: (status: PulseUploadStatus) => void;
  disabled?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  ariaLabel,
  onSettled,
  disabled,
}) => {
  const pulse = usePulseUpload(destination, { onSettled });
  return (
    <>
      <PulseChip pulse={pulse} ariaLabel={ariaLabel} disabled={disabled} />
      <PulseUploadModal pulse={pulse} />
    </>
  );
};
