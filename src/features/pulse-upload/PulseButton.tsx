/**
 * PulseButton — the one way to add a video with Pulse: a "Pulse" chip with the
 * Pulse logo, styled like the chips beside it. It reserves an upload for a
 * `destination`, then shows the QR code on a computer or opens the Pulse app
 * on a phone, and says where the video went. See {@link usePulseUpload}.
 *
 * `PulseButton` owns its upload. A host that needs the link or the status
 * itself calls `usePulseUpload` and renders `PulseChip` and
 * {@link PulseUploadModal} from it.
 */
import { Button, cn, Text } from '@mieweb/ui';
import React from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { PulseLogo } from './PulseLogo';
import { EXPIRED_MESSAGE, followUpNote, keptMessage, landedLabel } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, for screen readers: "Add a video with Pulse". */
  ariaLabel: string;
  /**
   * Where Pulse is the page's main way in (the Clock page), the page's primary
   * pill with this label. Otherwise it's a "Pulse" chip like the ones beside it.
   */
  main?: { label: string; className: string };
  disabled?: boolean;
}

/**
 * The Pulse chip, with what went wrong beside it. A video that landed needs
 * no words here: it is where the link said, and the modal has already said so
 * — the chip's row keeps its shape. Screen readers are still told.
 */
export const PulseChip: React.FC<PulseChipProps> = ({ pulse, ariaLabel, main, disabled }) => {
  const { reserving, error, status, modalOpen, destination } = pulse;
  // Phones have no modal: the same words the modal uses, beside the chip. A
  // landed video says nothing here — unless a step after delivery failed
  // (the plan posted but the clock-in didn't), which the note then says.
  const note = modalOpen
    ? ''
    : status?.state === 'kept'
      ? keptMessage(status.reason)
      : status?.state === 'expired'
        ? EXPIRED_MESSAGE
        : status?.state === 'done'
          ? followUpNote(destination, status.note)
          : '';
  const announced = !modalOpen && status?.state === 'done' ? landedLabel(destination) : '';
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
          {note || announced}
        </Text>
      )}
    </>
  );
};

interface PulseButtonProps {
  destination: PulseDestination;
  ariaLabel: string;
  /** Called once the video has landed: `done`, or `kept` with the reason. */
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
    <div className="pulse-upload flex flex-wrap items-center gap-2">
      <PulseChip pulse={pulse} ariaLabel={ariaLabel} disabled={disabled} />
      <PulseUploadModal
        open={pulse.modalOpen}
        onClose={pulse.closeModal}
        scanLink={pulse.link?.scanLink ?? null}
        destination={pulse.destination}
        status={pulse.status}
      />
    </div>
  );
};
