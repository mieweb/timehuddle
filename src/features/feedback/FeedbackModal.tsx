/**
 * FeedbackModal — Embeds the Pollenate feedback page in a modal iframe.
 */
import { Modal, ModalBody, ModalHeader } from '@mieweb/ui';
import React from 'react';

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
const FEEDBACK_URL =
  ENV.VITE_POLLENATE_FEEDBACK_URL ||
  'https://pollenate.dev/f/medical-informatics-engineering-3/huddle-feedback-gze8e7?embed=true';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const FeedbackModal: React.FC<Props> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <Modal open={open} onOpenChange={(isOpen) => !isOpen && onClose()} size="lg">
      <ModalHeader>
        <div className="flex w-full items-center justify-between">
          <span>Share Your Feedback</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>
      </ModalHeader>
      <ModalBody>
        <iframe
          src={FEEDBACK_URL}
          width="100%"
          height="600"
          title="Huddle feedback"
          style={{ border: 'none', borderRadius: '8px', display: 'block' }}
        />
      </ModalBody>
    </Modal>
  );
};
