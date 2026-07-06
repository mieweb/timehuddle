import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@mieweb/ui';
import React from 'react';

interface ReportIssueModalProps {
  open: boolean;
  onClose: () => void;
}

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
const PAGE_SLUG = ENV.VITE_POLLENATE_BUGS_PAGE_SLUG || 'bug-reports';
const POLLENATE_URL = `https://pollenate.dev/f/medical-informatics-engineering-3/${PAGE_SLUG}`;
const GITHUB_URL = 'https://github.com/mieweb/timehuddle/issues/new';

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ open, onClose }) => {
  const handleOpenGitHub = () => {
    window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
    onClose();
  };

  const handleOpenPollenate = () => {
    window.open(POLLENATE_URL, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <Modal open={open} onOpenChange={(isOpen) => !isOpen && onClose()} size="sm">
      <ModalHeader>Report an Issue</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Found a bug or have a feature request? Choose where you'd like to report it:
          </p>

          <div className="space-y-3">
            <button
              onClick={handleOpenGitHub}
              className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <svg
                viewBox="0 0 16 16"
                width="20"
                height="20"
                fill="currentColor"
                className="mt-0.5 shrink-0"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <div className="flex-1">
                <div className="font-medium text-neutral-900 dark:text-neutral-100">
                  GitHub Issues
                </div>
                <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Report bugs, request features, or track development publicly
                </div>
              </div>
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="currentColor"
                className="mt-1 shrink-0 text-neutral-400"
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            <button
              onClick={handleOpenPollenate}
              className="flex w-full items-start gap-3 rounded-lg border border-neutral-200 p-4 text-left transition-colors hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="mt-0.5 shrink-0"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <div className="flex-1">
                <div className="font-medium text-neutral-900 dark:text-neutral-100">
                  Pollenate Feedback
                </div>
                <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Submit feedback or suggestions through our feedback portal
                </div>
              </div>
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="currentColor"
                className="mt-1 shrink-0 text-neutral-400"
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 14.78a.75.75 0 001.06 0l7.22-7.22v5.69a.75.75 0 001.5 0v-7.5a.75.75 0 00-.75-.75h-7.5a.75.75 0 000 1.5h5.69l-7.22 7.22a.75.75 0 000 1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};
