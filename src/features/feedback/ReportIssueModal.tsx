/**
 * ReportIssueModal — Bug description form.
 *
 * Submits to Pollenate /collect with type="text" + required comment.
 *
 * Required env vars (VITE_ prefix — safe, collect-scope only):
 *   VITE_POLLENATE_API_KEY
 *   VITE_POLLENATE_BUGS_INBOX_KEY
 */
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { useSession } from '../../lib/useSession';

interface ReportIssueModalProps {
  open: boolean;
  onClose: () => void;
}

const ENV = (import.meta as { env?: Record<string, string> }).env ?? {};
const API_KEY = ENV.VITE_POLLENATE_API_KEY || undefined;
const INBOX_KEY = ENV.VITE_POLLENATE_BUGS_INBOX_KEY || undefined;
const FEATURE_INBOX_KEY = ENV.VITE_POLLENATE_FEATURE_INBOX_KEY || undefined;
const API_URL = 'https://api.pollenate.dev/collect';

type IssueType = 'bug' | 'feature';

const ISSUE_TYPES: { value: IssueType; label: string; emoji: string }[] = [
  { value: 'bug', label: 'Bug', emoji: '🐛' },
  { value: 'feature', label: 'Feature Request', emoji: '✨' },
];

export const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ open, onClose }) => {
  const { user } = useSession();
  const [comment, setComment] = useState('');
  const [issueType, setIssueType] = useState<IssueType>('bug');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setComment('');
      setIssueType('bug');
      setSubmitting(false);
      setSubmitted(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!comment.trim()) {
      setError('Please describe the issue.');
      return;
    }
    if (!API_KEY || !INBOX_KEY) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pollenate-Key': API_KEY },
        body: JSON.stringify({
          inboxKey: issueType === 'bug' ? INBOX_KEY : FEATURE_INBOX_KEY,
          type: 'text',
          comment: comment.trim(),
          context: {
            ...(user?.id ? { userId: user.id } : {}),
            ...(user?.name ? { userName: user.name } : {}),
            page: window.location.pathname,
            source: 'report-issue',
            issueType, // 'bug' or 'feature' — used in GitHub issue label
          },
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setSubmitted(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [comment, issueType, onClose, user]);

  return (
    <Modal open={open} onOpenChange={(isOpen) => !isOpen && onClose()} size="sm">
      <ModalHeader>
        <div className="flex w-full items-center justify-between">
          <span>Report an Issue</span>
          <a
            href="https://github.com/mieweb/timehuddle/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs font-normal text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            title="Open a GitHub issue directly"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub Issues
          </a>
        </div>
      </ModalHeader>
      <ModalBody>
        {!API_KEY || !INBOX_KEY ? (
          <p className="py-4 text-center text-sm text-neutral-500">
            Issue reporting is not configured yet.
          </p>
        ) : submitted ? (
          <p className="py-6 text-center text-sm font-medium text-green-600">
            🎉 Thank you — we received your report!
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Issue Type Selector */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Type
              </p>
              <div className="flex gap-2">
                {ISSUE_TYPES.map(({ value, label, emoji }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setIssueType(value)}
                    disabled={submitting}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors
                      ${issueType === value
                        ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                      }`}
                  >
                    <span>{emoji}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Comment */}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Describe the issue
              </p>
              <textarea
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                rows={4}
                placeholder="Tell us more..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={submitting}
                aria-label="Issue description"
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <p className="text-right text-xs text-neutral-400">
              Powered by{' '}
              <a
                href="https://pollenate.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Pollenate
              </a>
            </p>
          </div>
        )}
      </ModalBody>
      {API_KEY && INBOX_KEY && !submitted && (
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !comment.trim()}>
            {submitting ? 'Sending…' : 'Send Report'}
          </Button>
        </ModalFooter>
      )}
    </Modal>
  );
};