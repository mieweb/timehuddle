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
import { Text } from '@mieweb/ui';
import React from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { PulseLogo } from './PulseLogo';
import { EXPIRED_MESSAGE, keptMessage, landedLabel, type PulseCopy } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseLink, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, for screen readers: "Add a video with Pulse". */
  ariaLabel: string;
  /** The landed line in the host's words, when the destination kind's doesn't fit. */
  copy?: PulseCopy;
  disabled?: boolean;
}

/** The Pulse chip, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({ pulse, ariaLabel, copy, disabled }) => {
  const { reserving, error, status, modalOpen, destination } = pulse;
  // Phones have no modal: the same words the modal uses, beside the chip.
  const note = modalOpen
    ? ''
    : status?.state === 'done'
      ? (copy?.landed ?? landedLabel(destination))
      : status?.state === 'kept'
        ? keptMessage(status.reason)
        : status?.state === 'expired'
          ? EXPIRED_MESSAGE
          : '';
  return (
    <>
      <ComposerChipButton
        leftIcon={<PulseLogo className="h-3.5" />}
        onClick={() => void pulse.start()}
        disabled={disabled || reserving}
        aria-busy={reserving}
        aria-label={ariaLabel}
      >
        Pulse
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
  ariaLabel: string;
  /** Called once the video has landed: `done`, or `kept` with the reason — and on which link. */
  onSettled?: (status: PulseUploadStatus, link: PulseLink) => void;
  /** Hint and landed line in the host's words, when the destination kind's don't fit. */
  copy?: PulseCopy;
  disabled?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  ariaLabel,
  onSettled,
  copy,
  disabled,
}) => {
  const pulse = usePulseUpload(destination, { onSettled });
  return (
    <div className="pulse-upload flex flex-wrap items-center gap-2">
      <PulseChip pulse={pulse} ariaLabel={ariaLabel} copy={copy} disabled={disabled} />
      <PulseUploadModal
        open={pulse.modalOpen}
        onClose={pulse.closeModal}
        scanLink={pulse.link?.scanLink ?? null}
        destination={pulse.destination}
        copy={copy}
        status={pulse.status}
      />
    </div>
  );
};
