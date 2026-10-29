import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  buttonVariants,
  cn,
  ModalBody,
  ModalClose,
  ModalHeader,
  ModalTitle,
  Spinner,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import { QRCodeSVG } from 'qrcode.react';
import React, { useId } from 'react';

import type { PulseDestination, PulseUploadStatus } from '../../lib/api';
import { isMobileBrowser } from '../../lib/device';
import { PulseLogo } from './PulseLogo';
import { EXPIRED_MESSAGE, followUpNote, keptMessage, landedLabel, uploadHint } from './pulseStatus';

export interface PulseUploadModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Pulse's https pairing link (see pulseLinks.ts), or null while reserving:
   * the QR's target on a computer, the "Open Pulse" link on a phone. Pulse
   * opens from it when installed; otherwise Pulse's page sends the person to
   * the App Store or Google Play and keeps the link for after the install.
   */
  link: string | null;
  /** Where the video goes, for the hint and the landed line. */
  destination: PulseDestination;
  /** Where the video stands, for the status line; null before there is a link. */
  status: PulseUploadStatus | null;
}

/**
 * The one Pulse window. On a computer: a QR code to scan with a phone. In a
 * phone's browser, only when the tap on Pulse couldn't open it (no link was
 * ready yet, and a Universal Link / App Link opens the app only from a tap):
 * an "Open Pulse" link to tap. Both with a live status line that says where
 * the video went when it lands ("Added to this ticket ✓"). Closing it earlier
 * loses nothing: the server delivers the upload wherever it was meant to go.
 * Presentational — the host owns the link and the status (see
 * {@link usePulseUpload}).
 */
export const PulseUploadModal: React.FC<PulseUploadModalProps> = ({
  open,
  onClose,
  link,
  destination,
  status,
}) => {
  const titleId = useId();
  const onPhone = isMobileBrowser();
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
        {/* On a short screen (a phone on its side) the QR sits beside the
            words instead of above them, so the status line stays in view. */}
        <div className="pulse-modal-body flex flex-col items-center gap-4 py-2 [@media(max-height:520px)]:flex-row [@media(max-height:520px)]:items-start [@media(max-height:520px)]:justify-center">
          {link && !onPhone && (
            <div className="pulse-modal-qr shrink-0 rounded-lg border border-border bg-white p-4 [@media(max-height:520px)]:p-2">
              <QRCodeSVG
                value={link}
                size={200}
                className="h-auto w-[200px] max-w-full [@media(max-height:520px)]:w-[140px]"
                aria-label="QR code to open the Pulse upload screen"
              />
            </div>
          )}

          <div className="pulse-modal-details flex min-w-0 flex-col items-center gap-4">
            {link && onPhone && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: 'primary' }),
                  'pulse-modal-open gap-2 px-6',
                )}
              >
                Open Pulse
              </a>
            )}

            <div className="pulse-modal-copy flex max-w-xs flex-col gap-1">
              <Text size="sm" weight="medium" className="text-center">
                {onPhone
                  ? 'Record in Pulse, then come back here.'
                  : 'Scan with your phone to record in Pulse.'}
              </Text>
              <Text size="sm" variant="muted" className="text-center">
                {uploadHint(destination)}
              </Text>
              <Text size="xs" variant="muted" className="pulse-modal-no-app text-center">
                No Pulse yet? Your phone goes to the App Store or Google Play first.
              </Text>
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
                    {followUpNote(destination, status.note) || landedLabel(destination)}
                  </Text>
                </span>
              ) : status?.state === 'kept' ? (
                <Text size="xs" variant="muted" className="max-w-xs text-center">
                  {keptMessage(status.reason)}
                </Text>
              ) : status?.state === 'expired' ? (
                <Text size="xs" variant="muted">
                  {EXPIRED_MESSAGE}
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
        </div>
      </ModalBody>
    </AppModal>
  );
};
