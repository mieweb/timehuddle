import { faCircleCheck, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import { QRCodeSVG } from 'qrcode.react';
import React, { useId } from 'react';

import { PulseLogo } from './PulseLogo';
import { keptMessage, landedLabel, titleHint } from './pulseStatus';
import type { PulseUpload } from './usePulseUpload';

/**
 * The one Pulse modal, shown on a computer for a {@link usePulseUpload} link: a
 * QR code to scan with a phone, and a live status line. When the video lands
 * it says what happened ("Posted to Huddle ✓") and closes itself. Closing it
 * earlier loses nothing: the server delivers the upload wherever it was meant
 * to go.
 *
 * The QR encodes the https `/pulse/open` link, which resolves to the
 * `pulsecam://` deep link on a phone that has Pulse, and to the App Store /
 * Play Store listing on one that doesn't.
 */
export const PulseUploadModal: React.FC<{ pulse: PulseUpload }> = ({ pulse }) => {
  const { modalOpen, closeModal, scanLink, status, destination } = pulse;
  const titleId = useId();
  return (
    <AppModal
      open={modalOpen}
      onOpenChange={(next) => !next && closeModal()}
      aria-labelledby={titleId}
    >
      <ModalHeader>
        <ModalTitle id={titleId}>
          <span className="pulse-modal-title flex items-center gap-2">
            <PulseLogo className="h-5" />
            Record with Pulse
          </span>
        </ModalTitle>
        <ModalClose />
      </ModalHeader>

      <ModalBody>
        <div className="pulse-modal-body flex flex-col items-center gap-4 py-2">
          {scanLink && (
            <div className="pulse-modal-qr rounded-lg border border-border bg-white p-4">
              <QRCodeSVG
                value={scanLink}
                size={200}
                aria-label="QR code to open the Pulse upload screen"
              />
            </div>
          )}

          <Text size="sm" className="max-w-xs text-center text-muted-foreground">
            Scan with your phone&rsquo;s camera to open the{' '}
            <strong className="text-foreground">Pulse camera</strong> and record. Once it&rsquo;s
            uploaded, the video ends up right where you started, with nothing to attach. No app yet?
            The scan takes you to the App Store or Play Store.
          </Text>
          {titleHint(destination) && (
            <Text size="xs" variant="muted" className="max-w-xs text-center">
              {titleHint(destination)}
            </Text>
          )}

          <div
            className="pulse-modal-status flex flex-col items-center gap-1"
            role="status"
            aria-live="polite"
          >
            {status?.state === 'done' && status.note ? (
              // Delivered, but a step after it failed: the note says both, so
              // the usual "you're clocked in" line would contradict it.
              <Text size="sm" className="max-w-xs text-center">
                {status.note}
              </Text>
            ) : status?.state === 'done' ? (
              <span className="pulse-modal-landed flex items-center gap-2">
                <FontAwesomeIcon
                  icon={faCircleCheck}
                  className="text-green-600 dark:text-green-500"
                  aria-hidden="true"
                />
                <Text size="sm" weight="medium">
                  {landedLabel(destination)}
                </Text>
              </span>
            ) : status?.state === 'kept' ? (
              <Text size="xs" variant="muted" className="max-w-xs text-center">
                {keptMessage(status.reason)}
              </Text>
            ) : status?.state === 'expired' ? (
              <Text size="xs" variant="muted">
                This link has expired. Close this and press Pulse again for a new one.
              </Text>
            ) : (
              <span className="pulse-modal-waiting flex items-center gap-2">
                <Spinner size="xs" />
                <Text size="xs" variant="muted">
                  Waiting for your video to upload.
                </Text>
              </span>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button size="sm" variant="ghost" onClick={closeModal}>
          <FontAwesomeIcon icon={faXmark} className="mr-1.5" aria-hidden="true" />
          Close
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
