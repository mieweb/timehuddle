/**
 * PulseButton — the one way to add a video anywhere in TimeHuddle: a "Pulse"
 * chip with the Pulse logo, styled like the chips beside it (Ticket, Link).
 * Where Pulse is the page's main way in (the Clock page) it's the page's
 * primary pill instead. It reserves an upload for a `destination`, then shows
 * the QR code (computer) or opens the Pulse app (phone). See
 * {@link usePulseUpload}.
 *
 * `PulseButton` owns its upload. A host that swaps the button out while a
 * video may still be on its way calls `usePulseUpload` itself and renders
 * `PulseChip` and `PulseUploadModal` from it instead, so the watch and the
 * modal outlive the button.
 */
import { Button, cn, Text } from '@mieweb/ui';
import React from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { PulseLogo } from './PulseLogo';
import { keptMessage } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, for screen readers: "Post a video with Pulse". */
  ariaLabel: string;
  /**
   * Where Pulse is the page's main way in (the Clock page): the page's primary
   * pill with this label. Otherwise it's a "Pulse" chip like the ones beside it.
   */
  main?: { label: string; className: string };
  disabled?: boolean;
}

/** The Pulse button, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({ pulse, ariaLabel, main, disabled }) => {
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
  const shared = {
    onClick: () => void pulse.start(),
    disabled: disabled || reserving,
    'aria-busy': reserving,
    'aria-label': ariaLabel,
  };
  return (
    <>
      {main ? (
        <Button
          type="button"
          variant="primary"
          size="lg"
          leftIcon={<PulseLogo inverse className="h-5" />}
          className={cn('pulse-button', main.className)}
          {...shared}
        >
          {reserving ? 'Opening Pulse…' : main.label}
        </Button>
      ) : (
        <ComposerChipButton leftIcon={<PulseLogo className="h-3.5" />} {...shared}>
          Pulse
        </ComposerChipButton>
      )}

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
  ariaLabel: string;
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
