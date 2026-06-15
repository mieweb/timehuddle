/**
 * FeedbackModal — Opens the Pollenate feedback page.
 *
 * On native (Capacitor iOS/Android): opens in the in-app browser.
 * On web: opens in a new tab. Embedding via iframe is blocked by the site's
 * X-Frame-Options: deny header.
 */
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Button, Modal, ModalBody, ModalHeader } from '@mieweb/ui';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';
import React, { useEffect } from 'react';

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
const FEEDBACK_URL =
  ENV.VITE_POLLENATE_FEEDBACK_URL ||
  'https://pollenate.dev/f/medical-informatics-engineering-3/huddle-feedback-gze8e7?embed=true';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const FeedbackModal: React.FC<Props> = ({ open, onClose }) => {
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (open && isNative) {
      Browser.open({ url: FEEDBACK_URL, presentationStyle: 'popover' })
        .catch(() => Browser.open({ url: FEEDBACK_URL }))
        .finally(() => onClose());
    }
  }, [open, isNative, onClose]);

  if (!open || isNative) return null;

  return (
    <Modal open={open} onOpenChange={(isOpen) => !isOpen && onClose()} size="sm">
      <ModalHeader>Share Your Feedback</ModalHeader>
      <ModalBody>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Our feedback form opens in a new tab. Your input helps us improve TimeHuddle.
          </p>
          <Button
            variant="primary"
            rightIcon={<FontAwesomeIcon icon={faArrowUpRightFromSquare} />}
            onClick={() => {
              window.open(FEEDBACK_URL, '_blank', 'noopener,noreferrer');
              onClose();
            }}
          >
            Open Feedback Form
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
};
