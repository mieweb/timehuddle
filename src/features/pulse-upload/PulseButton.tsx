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
import { faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, cn, Spinner, Text } from '@mieweb/ui';
import React, { useRef } from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { ComposerChipButton } from '../huddle/ComposerChipButton';
import { PulseLogo } from './PulseLogo';
import { EXPIRED_MESSAGE, followUpNote, keptMessage, landedLabel } from './pulseStatus';
import { PulseUploadModal } from './PulseUploadModal';
import { usePulseUpload, type PulseUpload } from './usePulseUpload';
import { VIDEO_FILE_ACCEPT } from './videoFile';

interface PulseChipProps {
  pulse: PulseUpload;
  /** What pressing it does, for screen readers: "Add a video with Pulse". */
  ariaLabel: string;
  /**
   * Where Pulse is the page's main way in (the Clock page), a primary button
   * with this label and no logo: the card around it carries the Pulse logo.
   * Otherwise it's a "Pulse" chip like the ones beside it.
   */
  main?: { label: string; className: string };
  disabled?: boolean;
  /** Also offer "Upload": a video file from this device, sent to the same place. */
  allowFile?: boolean;
  /** Just the icons (Pulse logo, upload arrow), where a label beside them names them. */
  iconOnly?: boolean;
  /**
   * The card layout (a Videos section): an upload's progress is the Upload
   * button's own label ("Uploading 42%", "Processing…"), and errors and notes
   * come before the buttons rather than after them.
   */
  card?: boolean;
}

/**
 * The Pulse chip, with what went wrong beside it. A video that landed needs
 * no words here: it is where the link said, and the modal has already said so
 * — the chip's row keeps its shape. Screen readers are still told.
 */
export const PulseChip: React.FC<PulseChipProps> = ({
  pulse,
  ariaLabel,
  main,
  disabled,
  allowFile,
  iconOnly,
  card,
}) => {
  const { reserving, error, status, modalOpen, destination, progress, processing } = pulse;
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = progress !== null || processing;
  // A file on its way: said beside the chips, or (card) on the Upload button.
  const inFlight =
    progress !== null
      ? `${card ? 'Uploading' : 'Uploading…'} ${Math.round(progress * 100)}%`
      : processing
        ? card
          ? 'Processing…'
          : 'Processing your video…'
        : '';
  // Beside the chip, the same words the window uses — for when it's closed,
  // and in the TimeHuddle app, which opens Pulse without one. A landed video
  // says nothing here — unless a step after delivery failed (the plan posted
  // but the clock-in didn't), which the note then says.
  const note = inFlight
    ? card
      ? ''
      : inFlight
    : modalOpen
      ? ''
      : status?.state === 'kept'
        ? keptMessage(status.reason)
        : status?.state === 'expired'
          ? EXPIRED_MESSAGE
          : status?.state === 'done'
            ? followUpNote(destination, status.note)
            : '';
  const announced =
    (card && inFlight) || (!modalOpen && status?.state === 'done' ? landedLabel(destination) : '');
  const shared = {
    onClick: () => void pulse.start(),
    disabled: disabled || reserving || sending,
    'aria-busy': reserving,
    'aria-label': ariaLabel,
  };
  const pulseControl = main ? (
    <Button
      type="button"
      variant="primary"
      className={cn('pulse-button', main.className)}
      {...shared}
    >
      {reserving ? 'Opening Pulse…' : main.label}
    </Button>
  ) : (
    <ComposerChipButton leftIcon={<PulseLogo className="h-3.5" />} {...shared}>
      {iconOnly ? undefined : 'Pulse'}
    </ComposerChipButton>
  );
  const chips = allowFile ? (
    <span className="pulse-upload-chips inline-flex shrink-0 items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        className="hidden"
        aria-label="Choose a video file to upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void pulse.upload(file);
        }}
      />
      {pulseControl}
      <ComposerChipButton
        onClick={() => fileInput.current?.click()}
        disabled={disabled || reserving || sending}
        aria-busy={sending}
        aria-label="Upload a video file"
        leftIcon={
          sending ? (
            <Spinner size="xs" className="text-current" />
          ) : (
            <FontAwesomeIcon icon={faUpload} className="h-3 w-3" />
          )
        }
      >
        {iconOnly ? undefined : (
          <span className="tabular-nums">{inFlight && card ? inFlight : 'Upload'}</span>
        )}
      </ComposerChipButton>
    </span>
  ) : (
    pulseControl
  );
  const errorText = error && (
    <Text
      as="span"
      size="xs"
      className={cn('pulse-chip-error text-red-500 dark:text-red-400', card && 'min-w-40 text-end')}
      role="alert"
    >
      {error}
    </Text>
  );
  // Mounted while there's a link, so the update is announced.
  const statusText = (status || sending) && (
    <Text
      as="span"
      size="xs"
      variant="muted"
      role="status"
      className={cn('pulse-chip-status', !note && 'sr-only', card && note && 'min-w-40 text-end')}
    >
      {note || announced}
    </Text>
  );
  // Card: messages come first, so they sit to the left of the buttons.
  return card ? (
    <>
      {errorText}
      {statusText}
      {chips}
    </>
  ) : (
    <>
      {chips}
      {errorText}
      {statusText}
    </>
  );
};

interface PulseButtonProps {
  destination: PulseDestination;
  ariaLabel: string;
  /** Called once the video has landed: `done`, or `kept` with the reason. */
  onSettled?: (status: PulseUploadStatus) => void;
  disabled?: boolean;
  /** Also offer "Upload": a video file from this device, sent to the same place. */
  allowFile?: boolean;
  /** Just the icons, where a label beside them names them (see PulseChip). */
  iconOnly?: boolean;
  /**
   * The card layout (see PulseChip `card`), with the buttons at the row's
   * `end` (a section header) or `start`. Messages sit to the left of the
   * buttons; where the row has no room for them (a phone) they wrap onto a
   * line of their own under the buttons.
   */
  card?: 'start' | 'end';
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  ariaLabel,
  onSettled,
  disabled,
  allowFile,
  iconOnly,
  card,
}) => {
  const pulse = usePulseUpload(destination, { onSettled });
  return (
    <div
      className={cn(
        'pulse-upload flex items-center gap-2',
        // wrap-reverse: the buttons keep the first line, a message that
        // doesn't fit beside them drops below.
        card
          ? cn(
              'min-w-0 flex-1 flex-wrap-reverse gap-y-1',
              card === 'end' ? 'justify-end' : 'justify-start',
            )
          : 'flex-wrap',
      )}
    >
      <PulseChip
        pulse={pulse}
        ariaLabel={ariaLabel}
        disabled={disabled}
        allowFile={allowFile}
        iconOnly={iconOnly}
        card={Boolean(card)}
      />
      <PulseUploadModal
        open={pulse.modalOpen}
        onClose={pulse.closeModal}
        link={pulse.link?.url ?? null}
        destination={pulse.destination}
        status={pulse.status}
      />
    </div>
  );
};
