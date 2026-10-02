/**
 * PulseButton — the one way to add a video anywhere in TimeHuddle: the page's
 * primary pill with the Pulse logo and what it does ("Post with Pulse"),
 * the same everywhere. It reserves an upload for a `destination`, then shows
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
import { PulseLogo } from './PulseLogo';
import { keptMessage } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, ending "with Pulse": "Post with Pulse". */
  label: string;
  /** `md` beside a full-size field, `lg` where Pulse is a main way in (the Clock page). */
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Extra classes, to match the page's other main buttons. */
  className?: string;
}

/** The Pulse button, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({
  pulse,
  label,
  size = 'sm',
  disabled,
  className,
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
      <Button
        type="button"
        variant="primary"
        size={size}
        onClick={() => void pulse.start()}
        disabled={disabled || reserving}
        aria-busy={reserving}
        leftIcon={<PulseLogo inverse className={size === 'lg' ? 'h-5' : 'h-4'} />}
        className={cn('pulse-button shrink-0 gap-2 rounded-full font-semibold', className)}
      >
        {reserving ? 'Opening Pulse…' : label}
      </Button>

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
  label: string;
  /** Called once the video has landed: `done`, or `kept` in the library. */
  onSettled?: (status: PulseUploadStatus) => void;
  disabled?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  label,
  onSettled,
  disabled,
}) => {
  const pulse = usePulseUpload(destination, { onSettled });
  return (
    <>
      <PulseChip pulse={pulse} label={label} disabled={disabled} />
      <PulseUploadModal pulse={pulse} />
    </>
  );
};
