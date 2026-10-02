/**
 * PulseButton — the one way to add a video anywhere in TimeHuddle: a button
 * with the Pulse logo and what it does ("Post with Pulse"), which reserves an
 * upload for a `destination`, then shows the QR code (computer) or opens the
 * Pulse app (phone). See {@link usePulseUpload}.
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
}

/** The Pulse button, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({ pulse, label, size = 'sm', disabled }) => {
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
        variant="ghost"
        size={size}
        onClick={() => void pulse.start()}
        disabled={disabled || reserving}
        aria-busy={reserving}
        leftIcon={<PulseLogo className={size === 'lg' ? 'h-6' : 'h-4'} />}
        className={cn(
          'pulse-button shrink-0 gap-2 rounded-full border border-pulse/40 bg-pulse/5 font-semibold text-foreground dark:text-foreground',
          'hover:border-pulse/70 hover:bg-pulse/10 focus-visible:ring-pulse dark:bg-pulse/10 dark:hover:bg-pulse/20',
          size === 'lg' && 'px-6 py-3 text-base shadow-sm',
        )}
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
