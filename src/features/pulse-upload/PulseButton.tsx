/**
 * PulseButton — the one way to add a video with Pulse: a "Pulse" chip with the
 * Pulse logo, styled like the chips beside it. It reserves an upload for a
 * `destination`, then shows the QR code on a computer or opens the Pulse app
 * on a phone, and says where the video went. See {@link usePulseUpload}.
 *
 * `PulseButton` owns its upload. A host that needs the link or the status
 * itself, or shows the buttons in more than one place, calls `usePulseUpload`
 * and renders `PulseControls` (or `PulseChip` and {@link PulseUploadModal})
 * from it.
 */
import { faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, cn, Spinner, Text, Tooltip, useMediaQuery } from '@mieweb/ui';
import React, { useEffect, useRef, useState } from 'react';

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
   * with the Pulse logo and this label. Otherwise it's a "Pulse" chip like the
   * ones beside it.
   */
  main?: { label: string; className: string };
  disabled?: boolean;
  /** Also offer "Upload": a video file from this device, sent to the same place. */
  allowFile?: boolean;
  /**
   * The card layout (a Videos section): an upload's progress is the Upload
   * button's own label ("Uploading 42%", "Processing…"), and errors and notes
   * come before the buttons rather than after them.
   */
  card?: boolean;
  /**
   * Below `sm`, the chips show only their icons; `'always'`, at every width
   * (see ComposerChipButton `compact`), for a chip on each row of a list. That
   * one has its name in a tooltip, and says what went wrong there too, never
   * in words beside it: a row has no room for a sentence.
   */
  compact?: boolean | 'always';
  /**
   * With `allowFile`: hand the picked files to the host, which uploads each
   * in place (its own progress and cancel), instead of sending one through
   * `pulse`. Then neither button waits on a file, and several can be picked.
   */
  onFiles?: (files: File[]) => void;
}

/** What the Pulse chip does, shown on hover where the chip is its logo alone. */
const ICON_ONLY_TOOLTIP = 'Record with Pulse';
/** How long that chip's tooltip stays up by itself to say something went wrong. */
const ICON_ONLY_ALERT_MS = 6000;

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
  card,
  compact,
  onFiles,
}) => {
  const { reserving, error, status, modalOpen, destination, progress, processing } = pulse;
  const fileInput = useRef<HTMLInputElement>(null);
  // The logo alone: its name, and anything it has to say, are in its tooltip.
  const iconOnly = compact === 'always' && !main;
  // No tooltip where there is no hover: one that opens on a tap sits over the chip it names.
  const noHover = useMediaQuery('(hover: none)');
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
  // What the person has to be told, hovering or not: Pulse didn't start, or
  // the video didn't go where they sent it. On an icon-only chip the tooltip
  // comes up by itself to say so, for a while.
  const alertText = error || (status?.state === 'kept' ? note : '');
  const [alertUp, setAlertUp] = useState(false);
  // Whether hover or keyboard focus is asking for the chip's tooltip.
  const [tipAsked, setTipAsked] = useState(false);
  useEffect(() => {
    if (!iconOnly || !alertText) return;
    setAlertUp(true);
    const done = setTimeout(() => setAlertUp(false), ICON_ONLY_ALERT_MS);
    return () => {
      clearTimeout(done);
      setAlertUp(false);
    };
  }, [iconOnly, alertText]);
  const pulseButton = main ? (
    <Button
      type="button"
      variant="primary"
      leftIcon={<PulseLogo inverse className="h-5" />}
      className={cn('pulse-button', main.className)}
      {...shared}
    >
      {reserving ? 'Opening Pulse…' : main.label}
    </Button>
  ) : (
    <ComposerChipButton
      // Alone in its circle the logo is drawn larger: at a label's 14px its
      // heartbeat line is under a pixel wide and the mark looks out of focus.
      leftIcon={<PulseLogo className={compact === 'always' ? 'h-5' : 'h-3.5'} />}
      compact={compact}
      {...shared}
    >
      Pulse
    </ComposerChipButton>
  );
  // The logo alone gets its name in a tooltip, on hover and on keyboard
  // focus; while it has something to say, the tooltip says that instead.
  //
  // Always controlled. Left to keep its own open state for hover and focus,
  // the library's goes stale while an alert holds the tooltip open (the
  // pointer leaves, and it never hears), and the tooltip then stays up for
  // good. So it only reports what the pointer and keyboard ask
  // (`onOpenChange`), and this decides: open for an alert's six seconds, or
  // while asked where there is hover, and never over the QR window.
  const pulseControl = iconOnly ? (
    <Tooltip
      content={error || note || ICON_ONLY_TOOLTIP}
      placement="top"
      open={!modalOpen && (alertUp || (tipAsked && !noHover))}
      onOpenChange={setTipAsked}
    >
      {pulseButton}
    </Tooltip>
  ) : (
    pulseButton
  );
  const chips = allowFile ? (
    <span className="pulse-upload-chips inline-flex shrink-0 items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        multiple={Boolean(onFiles)}
        className="hidden"
        aria-label="Choose a video file to upload"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (onFiles) onFiles(files);
          else if (files[0]) void pulse.upload(files[0]);
        }}
      />
      {pulseControl}
      <ComposerChipButton
        compact={compact}
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
        <span className="tabular-nums">{inFlight && card ? inFlight : 'Upload'}</span>
      </ComposerChipButton>
    </span>
  ) : (
    pulseControl
  );
  const errorText = error && (
    <Text
      as="span"
      size="xs"
      className={cn(
        'pulse-chip-error text-red-500 dark:text-red-400',
        card && 'min-w-40 text-end',
        // Still announced; shown in the chip's tooltip.
        iconOnly && 'sr-only',
      )}
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
      className={cn(
        'pulse-chip-status',
        (!note || iconOnly) && 'sr-only',
        card && note && 'min-w-40 text-end',
      )}
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
  /**
   * The card layout (see PulseChip `card`), with the buttons at the row's
   * `end` (a section header) or `start`. Messages sit to the left of the
   * buttons; where the row has no room for them (a phone) they wrap onto a
   * line of their own under the buttons.
   */
  card?: 'start' | 'end';
  /** Below `sm`, the chips show only their icons; `'always'`, at every width. */
  compact?: boolean | 'always';
  /** See usePulseUpload `prepare`: a button on every row of a list passes whether its row is on screen. */
  prepare?: boolean;
}

export const PulseButton: React.FC<PulseButtonProps> = ({
  destination,
  onSettled,
  prepare,
  ...rest
}) => {
  const pulse = usePulseUpload(destination, { onSettled, prepare });
  return <PulseControls pulse={pulse} {...rest} />;
};

type PulseControlsProps = Omit<PulseButtonProps, 'destination' | 'onSettled' | 'prepare'> & {
  pulse: PulseUpload;
  /** See PulseChip `onFiles`. */
  onFiles?: (files: File[]) => void;
};

/**
 * PulseButton's buttons and QR window for a `pulse` the host holds itself, so
 * they can move around the layout (and remount) without losing an upload.
 */
export const PulseControls: React.FC<PulseControlsProps> = ({
  pulse,
  ariaLabel,
  disabled,
  allowFile,
  card,
  compact,
  onFiles,
}) => {
  return (
    <div
      className={cn(
        'pulse-upload flex items-center gap-2',
        // wrap-reverse: the buttons keep the first line, a message that
        // doesn't fit beside them drops below. No `min-w-0`: never narrower
        // than the buttons, so a header too narrow for them wraps them under
        // its heading instead of drawing them over it.
        card
          ? cn('flex-1 flex-wrap-reverse gap-y-1', card === 'end' ? 'justify-end' : 'justify-start')
          : 'flex-wrap',
      )}
    >
      <PulseChip
        pulse={pulse}
        ariaLabel={ariaLabel}
        disabled={disabled}
        allowFile={allowFile}
        card={Boolean(card)}
        compact={compact}
        onFiles={onFiles}
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
