import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ModalBody, ModalClose, ModalHeader, ModalTitle, Spinner, Text } from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import { QRCodeSVG } from 'qrcode.react';
import React, { useId } from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { PulseLogo } from './PulseLogo';
import { PulseStoreBadges } from './PulseStoreBadges';
import { keptMessage, landedLabel, uploadHint } from './pulseStatus';

export interface PulseUploadModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * The https `/pulse/open` link to encode as a QR code, or null while
   * reserving. It resolves to the `pulsecam://` deep link on a phone that has
   * Pulse, and to the App Store / Play Store listing on one that doesn't.
   */
  scanLink: string | null;
  /** Where the video goes, for the hint and the landed line. */
  destination: PulseDestination;
  /** Where the video stands, for the status line; null before there is a link. */
  status: PulseUploadStatus | null;
}

/**
 * The one Pulse modal, shown on a computer: a QR code to scan with a phone, and
 * a live status line. When the video lands it says what happened ("Added to
 * this ticket ✓"). Closing it earlier loses nothing: the server delivers the
 * upload wherever it was meant to go. Presentational — the host owns the link
 * and the status (see {@link usePulseUpload}).
 */
export const PulseUploadModal: React.FC<PulseUploadModalProps> = ({
  open,
  onClose,
  scanLink,
  destination,
  status,
}) => {
  const titleId = useId();
  return (
    <AppModal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      aria-labelledby={titleId}
      aria-label="Record a video with Pulse"
    >
      {/* No divider under the title: the body has no sections to set apart. */}
      <ModalHeader className="border-b-0">
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

          <div className="pulse-modal-copy flex max-w-xs flex-col gap-1">
            <Text size="sm" weight="medium" className="text-center">
              Scan with your phone to record in Pulse.
            </Text>
            <Text size="sm" variant="muted" className="text-center">
              {uploadHint(destination)}
            </Text>
          </div>

          <div className="pulse-modal-stores flex flex-col items-center gap-1.5">
            <Text size="xs" variant="muted">
              No Pulse app yet?
            </Text>
            <PulseStoreBadges />
          </div>

          <div
            className="pulse-modal-status flex flex-col items-center gap-1"
            role="status"
            aria-live="polite"
          >
            {status?.state === 'done' ? (
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
                  Waiting for your upload…
                </Text>
              </span>
            )}
          </div>
        </div>
      </ModalBody>
    </AppModal>
  );
};
