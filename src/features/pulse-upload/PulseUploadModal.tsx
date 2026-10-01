import { faCircleCheck, faVideo, faXmark } from '@fortawesome/free-solid-svg-icons';
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
import React from 'react';

import type { PulseUploadStatus } from '../../lib/api';
import { keptMessage } from './pulseStatus';

export interface PulseUploadModalProps {
  open: boolean;
  /** Close the modal. The video still goes where it belongs when it lands. */
  onClose: () => void;
  /**
   * The https `/pulse/open` link to encode as a QR code, or null while
   * reserving. It resolves to the `pulsecam://` deep link on a phone that has
   * Pulse, and to the App Store / Play Store listing on one that doesn't.
   */
  scanLink: string | null;
  /** Where the upload stands: waiting, delivered, kept elsewhere, or expired. */
  status: PulseUploadStatus;
  /** What landing did: "Posted", "Added", "Clocked in". */
  landedLabel: string;
}

/**
 * The one Pulse modal, shown on a computer by every {@link PulseButton}: a QR
 * code to scan with a phone, and a live status line. When the video lands it
 * says what happened ("Posted ✓") and closes itself. Closing it earlier loses
 * nothing: the server delivers the upload wherever it was meant to go.
 */
export const PulseUploadModal: React.FC<PulseUploadModalProps> = ({
  open,
  onClose,
  scanLink,
  status,
  landedLabel,
}) => (
  <AppModal
    open={open}
    onOpenChange={(next) => !next && onClose()}
    aria-label="Record a video with Pulse"
  >
    <ModalHeader>
      <ModalTitle>
        <span className="flex items-center gap-2">
          <FontAwesomeIcon icon={faVideo} aria-hidden="true" />
          Record with Pulse
        </span>
      </ModalTitle>
      <ModalClose />
    </ModalHeader>

    <ModalBody>
      <div className="pulse-modal-body flex flex-col items-center gap-4 py-2">
        <div className="pulse-modal-qr rounded-lg border border-border bg-white p-4">
          {scanLink ? (
            <QRCodeSVG
              value={scanLink}
              size={200}
              aria-label="QR code to open the Pulse upload screen"
            />
          ) : (
            <div className="flex h-[200px] w-[200px] items-center justify-center">
              <Spinner size="md" label="Preparing…" />
            </div>
          )}
        </div>

        <Text size="sm" className="max-w-xs text-center text-muted-foreground">
          Scan with your phone&rsquo;s camera to open the{' '}
          <strong className="text-foreground">Pulse app</strong>, then record and upload. No app
          yet? The scan takes you to the App Store or Play Store.
        </Text>

        <div
          className="pulse-modal-status flex items-center gap-2"
          role="status"
          aria-live="polite"
        >
          {status.state === 'done' ? (
            <>
              <FontAwesomeIcon
                icon={faCircleCheck}
                className="text-green-600 dark:text-green-500"
                aria-hidden="true"
              />
              <Text size="sm" weight="medium">
                {landedLabel}
              </Text>
            </>
          ) : status.state === 'kept' ? (
            <Text size="xs" variant="muted">
              {keptMessage(status.reason)}
            </Text>
          ) : status.state === 'expired' ? (
            <Text size="xs" variant="muted">
              This link has expired. Close this and press Pulse again for a new one.
            </Text>
          ) : (
            <>
              <Spinner size="xs" />
              <Text size="xs" variant="muted">
                Waiting for your video. Once it uploads, it goes straight where it belongs.
              </Text>
            </>
          )}
        </div>
      </div>
    </ModalBody>

    <ModalFooter>
      <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
        <FontAwesomeIcon icon={faXmark} className="mr-1.5" aria-hidden="true" />
        Close
      </Button>
    </ModalFooter>
  </AppModal>
);
