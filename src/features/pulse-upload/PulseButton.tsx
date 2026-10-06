/**
 * PulseButton — the one way to add a video with Pulse: a "Pulse" chip with the
 * Pulse logo, styled like the chips beside it. It reserves an upload for a
 * `destination`, then shows the QR code (computer) or opens the Pulse app
 * (phone), and says where the video went. See {@link usePulseUpload}.
 *
 * `PulseButton` owns its upload. A host that needs the link or the status
 * itself calls `usePulseUpload` and renders `PulseChip` and
 * {@link PulseUploadModal} from it.
 */
import { Text } from '@mieweb/ui';
import React, { useRef } from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { DeviceVideoUpload } from './DeviceVideoUpload';
import { PulseLogo } from './PulseLogo';
import { keptMessage } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, for screen readers: "Add a video with Pulse". */
  ariaLabel: string;
  disabled?: boolean;
}

/** The Pulse chip, with what went wrong or where the video went beside it. */
export const PulseChip: React.FC<PulseChipProps> = ({ pulse, ariaLabel, disabled }) => {
  const { reserving, error, status, modalOpen } = pulse;
  // Phones have no modal: say it here when the video went elsewhere.
  const note = !modalOpen && status?.state === 'kept' ? keptMessage(status.reason) : '';
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
  /** Called once the video has landed: `done`, or `kept` with the reason. */
  onSettled?: (status: PulseUploadStatus) => void;
  disabled?: boolean;
  /** Also offer picking an MP4 from this device, sent through the same link. */
  deviceUpload?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  ariaLabel,
  onSettled,
  disabled,
  deviceUpload,
}) => {
  const pulse = usePulseUpload(destination, { onSettled });
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="pulse-upload flex flex-wrap items-center gap-2">
      <PulseChip pulse={pulse} ariaLabel={ariaLabel} disabled={disabled} />
      {deviceUpload && <DeviceVideoUpload pulse={pulse} inputRef={fileInput} />}
      <PulseUploadModal
        open={pulse.modalOpen}
        onClose={pulse.closeModal}
        scanLink={pulse.link?.scanLink ?? null}
        destination={pulse.destination}
        status={pulse.status}
        onUploadFromDevice={
          deviceUpload
            ? () => {
                pulse.closeModal();
                fileInput.current?.click();
              }
            : undefined
        }
      />
    </div>
  );
};
