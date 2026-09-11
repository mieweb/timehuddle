/**
 * TimesheetApprovalsPanel — an admin's queue of timesheet changes waiting on
 * them, with the requester's written justification and video in view before
 * they rule.
 *
 * Lives alongside the admin timesheet rather than in a separate screen: the
 * decision is about the numbers on that timesheet, so it belongs where the
 * reviewer is already looking at them.
 */
import { faCheck, faVideo, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  timesheetApprovalApi,
  TIMECORE_BASE_URL,
  type TimesheetChangeRequest,
} from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';

const ACTION_LABEL: Record<TimesheetChangeRequest['action'], string> = {
  create: 'Add time',
  update: 'Change time',
  delete: 'Delete entry',
};

function videoSrc(url: string): string {
  return url.startsWith('http') ? url : `${TIMECORE_BASE_URL.replace(/\/$/, '')}${url}`;
}

interface Props {
  teamId?: string;
  /** Opened automatically when a notification deep-links to one request. */
  focusRequestId?: string | null;
}

export const TimesheetApprovalsPanel: React.FC<Props> = ({ teamId, focusRequestId }) => {
  const [requests, setRequests] = useState<TimesheetChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<TimesheetChangeRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await timesheetApprovalApi.listPending(teamId));
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefresh(load);

  // A notification names one request; open it directly rather than making the
  // reviewer find it in the list.
  useEffect(() => {
    if (!focusRequestId) return;
    const match = requests.find((r) => r.id === focusRequestId);
    if (match) {
      setActive(match);
      return;
    }
    // Not in the pending list — it may already be resolved, so fetch it to show why.
    timesheetApprovalApi
      .get(focusRequestId)
      .then(setActive)
      .catch(() => {});
  }, [focusRequestId, requests]);

  const close = useCallback(() => {
    setActive(null);
    setNote('');
    setError(null);
  }, []);

  const respond = useCallback(
    async (approved: boolean) => {
      if (!active) return;
      setBusy(approved ? 'approve' : 'reject');
      setError(null);
      try {
        if (approved) await timesheetApprovalApi.approve(active.id, note || undefined);
        else await timesheetApprovalApi.reject(active.id, note);
        setRequests((prev) => prev.filter((r) => r.id !== active.id));
        close();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Unable to record that decision.');
      } finally {
        setBusy(null);
      }
    },
    [active, note, close],
  );

  if (loading && requests.length === 0) {
    return (
      <div className="flex justify-center p-6">
        <Spinner size="md" label="Loading approvals…" />
      </div>
    );
  }

  if (requests.length === 0 && !active) return null;

  const rejectDisabled = busy !== null || note.trim().length === 0;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Timesheet approvals
            <Badge variant="warning" size="sm">
              {requests.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800" role="list">
            {requests.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setActive(r)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label={`Review ${r.requesterName}'s timesheet change`}
                >
                  <div className="min-w-0 flex-1">
                    <Text size="sm" weight="medium" className="truncate">
                      {r.requesterName} — {ACTION_LABEL[r.action]}
                    </Text>
                    <Text variant="muted" size="xs" className="truncate">
                      {r.summary ?? r.description}
                    </Text>
                  </div>
                  {r.videoUrl && (
                    <FontAwesomeIcon
                      icon={faVideo}
                      className="shrink-0 text-neutral-400"
                      title="Has a video"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Modal open={active !== null} onOpenChange={(o) => !o && close()}>
        <ModalHeader>
          <Text weight="semibold">
            {active ? `${active.requesterName} — ${ACTION_LABEL[active.action]}` : ''}
          </Text>
        </ModalHeader>
        <ModalBody className="space-y-4">
          {active?.status !== 'pending' && active && (
            <Text size="sm" variant="muted">
              This request was already {active.status}.
            </Text>
          )}

          {active?.summary && (
            <div className="rounded-md bg-neutral-50 px-3 py-2 dark:bg-neutral-800">
              <Text size="xs" variant="muted">
                Requested change
              </Text>
              <Text size="sm">{active.summary}</Text>
            </div>
          )}

          <div>
            <Text size="xs" variant="muted">
              Their explanation
            </Text>
            <Text size="sm">{active?.description}</Text>
          </div>

          {active?.videoUrl && (
            <video
              src={videoSrc(active.videoUrl)}
              controls
              playsInline
              className="w-full rounded-lg bg-black"
            />
          )}

          {active?.status === 'pending' && (
            <div className="space-y-1">
              <label htmlFor="approval-note">
                <Text size="xs" weight="medium">
                  Note {`(required to decline)`}
                </Text>
              </label>
              <Textarea
                id="approval-note"
                rows={2}
                value={note}
                disabled={busy !== null}
                placeholder="Optional when approving."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {error && (
            <Text size="xs" className="text-danger" role="alert">
              {error}
            </Text>
          )}
        </ModalBody>
        <ModalFooter>
          <div className="flex w-full flex-wrap items-center gap-2">
            {active?.status === 'pending' ? (
              <>
                <Button
                  variant="primary"
                  isLoading={busy === 'approve'}
                  disabled={busy !== null}
                  leftIcon={<FontAwesomeIcon icon={faCheck} />}
                  onClick={() => void respond(true)}
                >
                  Approve
                </Button>
                <Button
                  variant="danger"
                  isLoading={busy === 'reject'}
                  disabled={rejectDisabled}
                  leftIcon={<FontAwesomeIcon icon={faXmark} />}
                  onClick={() => void respond(false)}
                >
                  Decline
                </Button>
                <Button variant="ghost" className="ml-auto" onClick={close} disabled={busy !== null}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={close}>
                Close
              </Button>
            )}
          </div>
        </ModalFooter>
      </Modal>
    </>
  );
};
