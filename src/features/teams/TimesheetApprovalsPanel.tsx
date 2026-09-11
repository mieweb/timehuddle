/**
 * TimesheetApprovalsPanel — an admin's queue of timesheet changes waiting on
 * them, with the requester's written justification and video in view before
 * they rule.
 *
 * Lives alongside the admin timesheet rather than in a separate screen: the
 * decision is about the numbers on that timesheet, so it belongs where the
 * reviewer is already looking at them.
 */
import { faVideo } from '@fortawesome/free-solid-svg-icons';
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
import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  resolveMediaUrl,
  timesheetApprovalApi,
  type TimesheetChangeRequest,
} from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';
import { formatDuration } from '../../lib/timeUtils';

const ACTION_LABEL: Record<TimesheetChangeRequest['action'], string> = {
  create: 'Add time',
  update: 'Change time',
  delete: 'Delete entry',
};

function asEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const dayFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const clockFormat: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** "9:04am" — Intl gives "9:04 AM", which reads heavier than it needs to here. */
function shortTime(date: Date): string {
  return date
    .toLocaleTimeString(undefined, clockFormat)
    .replace(/\s*([AP])M/i, (_, p) => p.toLowerCase() + 'm');
}

/** "Sep 7, 9:04am – 4:04pm", naming the second date only when it differs. */
function formatRange(startMs: number | null, endMs: number | null): string | null {
  if (startMs === null) return null;
  const start = new Date(startMs);
  const startDay = start.toLocaleDateString(undefined, dayFormat);
  if (endMs === null) return `${startDay}, ${shortTime(start)} – still open`;

  const end = new Date(endMs);
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${startDay}, ${shortTime(start)} – ${shortTime(end)}`
    : `${startDay}, ${shortTime(start)} – ${end.toLocaleDateString(undefined, dayFormat)}, ${shortTime(end)}`;
}

function formatDurationBetween(startMs: number | null, endMs: number | null): string | null {
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return formatDuration(Math.round((endMs - startMs) / 1000));
}

/**
 * Paid time before and after, when the two differ.
 *
 * A break-only edit leaves the clock range identical while moving what the
 * entry is worth, so without this the reviewer would be shown two lines that
 * read the same and asked to rule on a change they cannot see.
 */
function describePaidTime(
  request: TimesheetChangeRequest,
): { before: string; after: string } | null {
  if (request.action !== 'update') return null;
  const currentPaid = asEpoch(request.current?.accumulatedTime);
  if (currentPaid === null) return null;

  const start = asEpoch(request.payload.startTime) ?? asEpoch(request.current?.startTime);
  const end =
    request.payload.endTime === null
      ? null
      : (asEpoch(request.payload.endTime) ?? asEpoch(request.current?.endTime));
  if (start === null || end === null) return null;

  const breaks = Array.isArray(request.payload.breaks) ? request.payload.breaks : null;
  if (!breaks) return null;
  const breakSeconds = breaks.reduce((sum, b) => {
    const bs = asEpoch((b as { startTime?: unknown }).startTime);
    const be = asEpoch((b as { endTime?: unknown }).endTime);
    return bs === null || be === null || be <= bs ? sum : sum + Math.floor((be - bs) / 1000);
  }, 0);

  const nextPaid = Math.max(0, Math.floor((end - start) / 1000) - breakSeconds);
  if (Math.round(nextPaid / 60) === Math.round(currentPaid / 60)) return null;
  return { before: formatDuration(currentPaid), after: formatDuration(nextPaid) };
}

/**
 * Before/after in the reviewer's own locale, built from the entry's live state
 * plus the proposed payload. The server deliberately stores neither — a
 * formatted snapshot would be stale and in the wrong timezone for whoever ends
 * up reading it.
 */
function describeChange(request: TimesheetChangeRequest): { before?: string; after?: string } {
  const currentStart = asEpoch(request.current?.startTime);
  const currentEnd = request.current?.endTime === null ? null : asEpoch(request.current?.endTime);
  const before = formatRange(currentStart, currentEnd) ?? undefined;

  if (request.action === 'delete') return { before };

  const nextStart = asEpoch(request.payload.startTime) ?? currentStart;
  const nextEnd =
    request.payload.endTime === null ? null : (asEpoch(request.payload.endTime) ?? currentEnd);
  const after = formatRange(nextStart, nextEnd) ?? undefined;

  return request.action === 'create' ? { after } : { before, after };
}

interface Props {
  teamId?: string;
  /** Opened automatically when a notification deep-links to one request. */
  focusRequestId?: string | null;
  /** Called once the deep link has been acted on, so remounting this panel
   *  (switching views) doesn't reopen a request the reviewer already closed. */
  onFocusHandled?: () => void;
  /** Keeps a badge outside this panel in step with a decision made inside it. */
  onPendingCountChange?: (count: number) => void;
}

export const TimesheetApprovalsPanel: React.FC<Props> = ({
  teamId,
  focusRequestId,
  onFocusHandled,
  onPendingCountChange,
}) => {
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

  // Reported on every change rather than only on load, so a badge elsewhere
  // drops the moment a decision removes a request from this list.
  useEffect(() => {
    if (!loading) onPendingCountChange?.(requests.length);
  }, [requests.length, loading, onPendingCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefresh(load);

  // A notification names one request; open it directly rather than making the
  // reviewer find it in the list. Guarded by id because the effect re-runs
  // whenever `requests` changes — including the moment a decision removes the
  // request, which would otherwise re-fetch the resolved one and reopen the
  // modal on top of the reviewer. The guard resets once the deep link is
  // cleared, so tapping the same notification again still works.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusRequestId) {
      autoOpenedRef.current = null;
      return;
    }
    if (autoOpenedRef.current === focusRequestId) return;

    const match = requests.find((r) => r.id === focusRequestId);
    if (match) {
      autoOpenedRef.current = focusRequestId;
      setActive(match);
      onFocusHandled?.();
      return;
    }
    if (loading) return;
    // Not in the pending list — it may already be resolved, so fetch it to show why.
    autoOpenedRef.current = focusRequestId;
    onFocusHandled?.();
    timesheetApprovalApi
      .get(focusRequestId)
      .then(setActive)
      .catch(() => {});
  }, [focusRequestId, requests, loading, onFocusHandled]);

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
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => setActive(r)}
                  className="h-auto justify-start gap-3 px-0 py-3 text-left font-normal"
                  aria-label={`Review ${r.requesterName}'s timesheet change`}
                >
                  <div className="min-w-0 flex-1">
                    <Text size="sm" weight="medium" className="truncate">
                      {r.requesterName} — {ACTION_LABEL[r.action]}
                    </Text>
                    <Text variant="muted" size="xs" className="truncate">
                      {describeChange(r).after ??
                        describeChange(r).before ??
                        r.label ??
                        r.description}
                    </Text>
                  </div>
                  {r.videoUrl && (
                    <FontAwesomeIcon
                      icon={faVideo}
                      className="shrink-0 text-neutral-400"
                      title="Has a video"
                    />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Modal
        open={active !== null}
        onOpenChange={(o) => !o && close()}
        className="mt-[env(safe-area-inset-top,0px)]"
      >
        <ModalHeader>
          <Text weight="semibold">
            {active ? `${active.requesterName} — ${ACTION_LABEL[active.action]}` : ''}
          </Text>
        </ModalHeader>
        <ModalBody className="space-y-3">
          {active?.status !== 'pending' && active && (
            <Text size="sm" variant="muted">
              This request was already {active.status}.
            </Text>
          )}

          {active &&
            (() => {
              const { before, after } = describeChange(active);
              const duration =
                active.action === 'delete'
                  ? null
                  : formatDurationBetween(
                      asEpoch(active.payload.startTime) ?? asEpoch(active.current?.startTime),
                      active.payload.endTime === null
                        ? null
                        : (asEpoch(active.payload.endTime) ?? asEpoch(active.current?.endTime)),
                    );
              // A timer entry, or a target that has since been deleted — no
              // clock range to lay out, so name what it refers to instead.
              if (!before && !after) {
                return active.label ? (
                  <div>
                    <Text size="xs" variant="muted">
                      Entry
                    </Text>
                    <Text size="sm">{active.label}</Text>
                  </div>
                ) : null;
              }
              return (
                <>
                  {before && (
                    <div>
                      <Text size="xs" variant="muted">
                        {active.action === 'delete' ? 'Entry to remove' : 'Currently'}
                      </Text>
                      <Text size="sm" className={after ? 'line-through opacity-70' : undefined}>
                        {before}
                      </Text>
                    </div>
                  )}
                  {after && (
                    <div>
                      <Text size="xs" variant="muted">
                        {before ? 'Changing to' : 'Adding'}
                      </Text>
                      <Text size="sm" weight="medium">
                        {after}
                        {duration ? ` (${duration})` : ''}
                      </Text>
                    </div>
                  )}
                </>
              );
            })()}

          {active &&
            (() => {
              const paid = describePaidTime(active);
              return paid ? (
                <div>
                  <Text size="xs" variant="muted">
                    Paid time
                  </Text>
                  <Text size="sm" weight="medium">
                    {paid.before} → {paid.after}
                  </Text>
                </div>
              ) : null;
            })()}

          <div>
            <Text size="xs" variant="muted">
              Their explanation
            </Text>
            <Text size="sm">{active?.description}</Text>
          </div>

          {active?.videoUrl && (
            // Capped so a portrait recording doesn't push the decision buttons
            // off the bottom of a phone screen.
            <video
              src={resolveMediaUrl(active.videoUrl)}
              controls
              playsInline
              className="max-h-[45vh] w-full rounded-lg bg-black"
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
          {/* Approve and Decline share a row and split the width. The icons are
              dropped: with them the labels truncated to "Appro…" on a phone,
              and the colours already carry the same signal. */}
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            {active?.status === 'pending' ? (
              <>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    className="flex-1"
                    isLoading={busy === 'approve'}
                    disabled={busy !== null}
                    onClick={() => void respond(true)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1"
                    isLoading={busy === 'reject'}
                    disabled={rejectDisabled}
                    onClick={() => void respond(false)}
                  >
                    Decline
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  className="sm:ml-auto"
                  onClick={close}
                  disabled={busy !== null}
                >
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
