import { faQrcode, faVideo, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';

export interface PulseUploadModalProps {
  open: boolean;
  onClose: () => void;
  /** The `pulsecam://` deep link to encode as a QR code, or null while reserving. */
  uploadLink: string | null;
  /** Fallback: pick an MP4 from this device instead of the phone. */
  onUploadFromDevice: () => void;
  /** Confirm the phone upload finished (host refreshes / polls). */
  onDone: () => void;
  /** Footer confirm label. Defaults to "Done — Refresh". */
  doneLabel?: string;
}

/**
 * Shared QR + device-upload modal for Pulse video uploads. Presentational only —
 * the host owns reservation, polling, and TUS upload. Used by both the
 * ticket-scoped {@link PulseUploadButton} and the huddle composer's
 * {@link PulseAttachButton} so the modal UI stays single-source.
 */
export const PulseUploadModal: React.FC<PulseUploadModalProps> = ({
  open,
  onClose,
  uploadLink,
  onUploadFromDevice,
  onDone,
  doneLabel = 'Done — Refresh',
}) => {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      aria-label="Upload video with the Pulse app"
    >
      <ModalHeader>
        <ModalTitle>
          <span className="flex items-center gap-2">
            <FontAwesomeIcon icon={faQrcode} />
            Upload Video with Pulse
          </span>
        </ModalTitle>
        <ModalClose />
      </ModalHeader>

      <ModalBody>
        <div className="video-upload-modal-body flex flex-col items-center gap-4 py-2">
          {uploadLink && (
            <div className="video-upload-qr-container rounded-lg border border-border bg-white p-4">
              <QRCodeSVG
                value={uploadLink}
                size={200}
                aria-label="QR code to open the Pulse upload screen"
              />
            </div>
          )}

          <Text size="sm" className="max-w-xs text-center text-muted-foreground">
            Scan with the <strong className="text-foreground">Pulse app</strong> on your phone. The
            attachment will appear automatically once the upload completes.
          </Text>

          <div className="video-upload-divider flex w-full items-center gap-3">
            <hr className="flex-1 border-border" />
            <Text size="xs" className="text-muted-foreground">
              or
            </Text>
            <hr className="flex-1 border-border" />
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={onUploadFromDevice}
            aria-label="Upload video from this device instead"
          >
            <FontAwesomeIcon icon={faVideo} className="mr-1.5" />
            Upload from this device
          </Button>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close without uploading">
          <FontAwesomeIcon icon={faXmark} className="mr-1.5" />
          Close
        </Button>
        <Button size="sm" onClick={onDone} aria-label="I have uploaded — refresh">
          {doneLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
