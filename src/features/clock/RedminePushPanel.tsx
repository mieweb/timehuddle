/**
 * The manual push of ticket time into Redmine (M5, Phase 4 — decisions D1/D2).
 *
 * Lives on the Clock page because that is where a day ends: clocking out is
 * already the "I'm done" action, so the push belongs beside it rather than on a
 * settings screen the user would have to remember to visit.
 *
 * Two rules shape every decision here:
 *   D1 — what is sent is **permanent**. Huddle never edits or deletes a Redmine
 *        entry, so the dialog is the last moment anything can be corrected.
 *        That is why the activity is shown and overridable, and why the
 *        confirmation states the consequence in words.
 *   D2 — the push is **manual**. Huddle holds the time until the user says so,
 *        which is what makes "is the day finished?" answerable at all.
 */
import {
  Badge,
  Button,
  Card,
  CardContent,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  redmineApi,
  type RedmineActivity,
  type RedmineTimeEntryPreview,
  type RedmineTimeEntryPushOutcome,
} from '../../lib/api';

/** Stable row identity; mirrors the server's `{ticketId, date}` grain. */
const rowKey = (row: { ticketId: string; date: string }) => `${row.ticketId}@${row.date}`;

/** Plain-English reasons, so a blocked row explains itself instead of just being disabled. */
const BLOCKED_TEXT: Record<string, string> = {
  'too-short': 'Under a minute — Redmine rejects a zero-hour entry',
  'issue-unavailable': 'Issue could not be loaded from Redmine',
  'no-activity': 'No activity could be resolved',
};

const FAILURE_TEXT: Record<string, string> = {
  'no-log-time-permission': 'Your Redmine role is missing “Log spent time”',
  'rejected-by-redmine': 'Redmine rejected the entry',
  unreachable: 'Could not reach Redmine',
  'hours-mismatch': 'Redmine stored different hours than we sent',
  'no-entry-id': 'Redmine did not return an entry id',
  'already-synced-or-gone': 'Already sent, or no longer eligible',
  'invalid-activity': 'That activity no longer exists in Redmine',
};

/** `0.51` → `0:31`, so hours read the way the rest of the app shows time. */
function asClock(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

export const RedminePushPanel: React.FC<{ isClockedIn: boolean }> = ({ isClockedIn }) => {
  const [preview, setPreview] = useState<RedmineTimeEntryPreview | null>(null);
  const [activities, setActivities] = useState<RedmineActivity[]>([]);
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [pushing, setPushing] = useState(false);
  const [results, setResults] = useState<RedmineTimeEntryPushOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, activityList] = await Promise.all([
        redmineApi.timeEntries.preview(),
        redmineApi.activities.list(),
      ]);
      setPreview(next);
      setActivities(activityList.activities);
      setError(null);
    } catch {
      // An unlinked or unreachable Redmine is the normal case on this page, not
      // something to shout about — the panel simply does not render.
      setPreview(null);
    }
  }, []);

  // Clocking in or out changes both the idle gate and what is eligible.
  useEffect(() => {
    void load();
  }, [load, isClockedIn]);

  const rows = preview?.rows ?? [];
  const sendable = useMemo(() => rows.filter((row) => row.blockedReason === null), [rows]);
  const blocked = useMemo(() => rows.filter((row) => row.blockedReason !== null), [rows]);
  const totalHours = useMemo(() => sendable.reduce((sum, row) => sum + row.hours, 0), [sendable]);

  const activityOptions = useMemo(
    () => activities.map((a) => ({ value: String(a.id), label: a.name })),
    [activities],
  );

  const resultByKey = useMemo(
    () => new Map((results ?? []).map((r) => [`${r.ticketId}@${r.date}`, r])),
    [results],
  );

  const handlePush = async () => {
    setPushing(true);
    try {
      const { results: outcome } = await redmineApi.timeEntries.push(
        sendable.map((row) => ({
          ticketId: row.ticketId,
          date: row.date,
          activityId: overrides[rowKey(row)] ?? row.activityId ?? undefined,
        })),
      );
      setResults(outcome);
      setError(null);
      // Successful rows drop out of the next preview; failures stay eligible.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send time to Redmine.');
    } finally {
      setPushing(false);
    }
  };

  const closeModal = () => {
    setOpen(false);
    setResults(null);
    setOverrides({});
    setError(null);
  };

  // Nothing to offer: not linked, or no unsynced Redmine time at all.
  if (!preview?.connected || rows.length === 0) return null;

  const idle = preview.idle;
  const canSend = idle && sendable.length > 0;

  return (
    <Card padding="lg" className="redmine-push-panel mb-4 shrink-0">
      <CardContent>
        <div className="redmine-push-summary flex flex-wrap items-center justify-between gap-3">
          <div className="redmine-push-copy">
            <Text weight="medium">Redmine time ready to send</Text>
            <Text variant="muted" size="xs" aria-live="polite">
              {sendable.length} ticket-day{sendable.length === 1 ? '' : 's'} · {asClock(totalHours)}
              {blocked.length > 0 && ` · ${blocked.length} can’t be sent`}
              {!idle && ' · clock out and stop all timers first'}
            </Text>
          </div>

          <Button
            variant="primary"
            onClick={() => setOpen(true)}
            disabled={!canSend}
            title={
              idle
                ? undefined
                : 'Clock out and stop every ticket timer before sending time to Redmine'
            }
          >
            Send work entries to Redmine
          </Button>
        </div>
      </CardContent>

      <Modal open={open} onOpenChange={(next) => (next ? setOpen(true) : closeModal())}>
        <ModalHeader>
          <ModalTitle>{results ? 'Sent to Redmine' : 'Send work entries to Redmine'}</ModalTitle>
          <ModalClose />
        </ModalHeader>

        <ModalBody>
          {!results && (
            <Text variant="muted" size="xs" className="mb-3 block">
              These become permanent Redmine time entries. They cannot be edited or deleted from
              TimeHuddle afterwards, so check the hours and activity now.
            </Text>
          )}

          <Table aria-label="Time entries to send to Redmine">
            <TableHeader>
              <TableRow>
                <TableHead>Issue</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Activity</TableHead>
                {results && <TableHead>Result</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const key = rowKey(row);
                const outcome = resultByKey.get(key);
                return (
                  <TableRow key={key}>
                    <TableCell>
                      <Text size="xs" weight="medium">
                        #{row.ticketId}
                      </Text>
                      <Text variant="muted" size="xs">
                        {row.subject ?? 'Unavailable'}
                      </Text>
                    </TableCell>
                    <TableCell>
                      <Text size="xs">{row.date}</Text>
                    </TableCell>
                    <TableCell>
                      <Text size="xs">
                        {asClock(row.hours)}{' '}
                        <Text as="span" variant="muted" size="xs">
                          ({row.hours.toFixed(2)}h)
                        </Text>
                      </Text>
                    </TableCell>
                    <TableCell>
                      {row.blockedReason ? (
                        <Badge variant="outline">{BLOCKED_TEXT[row.blockedReason]}</Badge>
                      ) : results ? (
                        <Text size="xs">{row.activityName}</Text>
                      ) : (
                        <Select
                          label={`Activity for issue ${row.ticketId} on ${row.date}`}
                          hideLabel
                          size="sm"
                          value={String(overrides[key] ?? row.activityId ?? '')}
                          options={activityOptions}
                          onValueChange={(v) =>
                            setOverrides((prev) => ({ ...prev, [key]: Number(v) }))
                          }
                          aria-label={`Activity for issue ${row.ticketId} on ${row.date}`}
                        />
                      )}
                    </TableCell>
                    {results && (
                      <TableCell>
                        {!outcome ? (
                          <Text variant="muted" size="xs">
                            Not sent
                          </Text>
                        ) : outcome.ok ? (
                          <Badge variant="success">Sent</Badge>
                        ) : (
                          <Badge variant="danger">
                            {FAILURE_TEXT[outcome.reason ?? ''] ?? outcome.reason}
                          </Badge>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {error && (
            <Text size="xs" variant="destructive" className="mt-3 block" aria-live="polite">
              {error}
            </Text>
          )}
        </ModalBody>

        <ModalFooter>
          {results ? (
            <Button variant="primary" onClick={closeModal}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={closeModal} disabled={pushing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handlePush}
                isLoading={pushing}
                loadingText="Sending…"
                disabled={sendable.length === 0}
              >
                Send {sendable.length} {sendable.length === 1 ? 'entry' : 'entries'} ·{' '}
                {asClock(totalHours)}
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>
    </Card>
  );
};
