/**
 * The manual push of ticket time into Redmine.
 *
 * Lives on the Clock page because that is where a day ends: clocking out is
 * already the "I'm done" action, so the push belongs beside it rather than on a
 * settings screen the user would have to remember to visit.
 *
 * Two rules shape every decision here:
 *   - What is sent is **permanent**. Huddle never edits or deletes a Redmine
 *     entry, so the dialog is the last moment anything can be corrected.
 *     That is why the activity is shown and overridable, and why the
 *     confirmation states the consequence in words.
 *   - The push is **manual**. Huddle holds the time until the user says so,
 *     which is what makes "is the day finished?" answerable at all.
 *
 * A row can also be marked **Never send** (e.g. one Redmine keeps rejecting):
 * nothing goes to Redmine, the time stays in TimeHuddle, and the row stops
 * being offered. Only time tracked on that day later comes back.
 */
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  ButtonGroup,
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
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  redmineApi,
  type RedmineActivity,
  type RedmineTimeEntryPreview,
  type RedmineTimeEntryPushOutcome,
  type RedmineTimeEntryRow,
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
  unconfirmed: 'Sent, but Redmine did not let us confirm it',
  'push-interrupted': 'Not sent: another push took over. Try again',
  'already-synced-or-gone': 'Already sent, or no longer eligible',
  'invalid-activity': 'That activity no longer exists in Redmine',
};

/**
 * Redmine messages whose wording hides the fix, keyed by their English text.
 * "Issue is invalid" is what Redmine answers when the issue is fine but you may
 * not log time on it: it drops an issue the key cannot see, or one in a project
 * where your role lacks "Log spent time" or time tracking is switched off.
 */
const REDMINE_MESSAGE_HINTS: Record<string, string> = {
  'Issue is invalid':
    "Redmine won't take time on this issue from you: its project may have time tracking switched off, or your role there may be missing “Log spent time”.",
};

/** Why a row failed: Redmine's own words when it gave any, else our summary. */
function failureText(outcome: RedmineTimeEntryPushOutcome): string {
  if (outcome.detail?.length) {
    return outcome.detail
      .map((message) => REDMINE_MESSAGE_HINTS[message] ?? `Redmine: ${message}`)
      .join(' ');
  }
  return FAILURE_TEXT[outcome.reason ?? ''] ?? outcome.reason ?? 'Not sent';
}

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
  // The rows as they were when sent. The preview is reloaded after a push and
  // sent rows drop out of it, so results must not be rendered from the live list.
  const [pushedRows, setPushedRows] = useState<RedmineTimeEntryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The row waiting for "Never send" to be confirmed, and one being discarded.
  const [confirmDiscard, setConfirmDiscard] = useState<RedmineTimeEntryRow | null>(null);
  const [discarding, setDiscarding] = useState(false);
  // The trash button that asked, so "Keep it" can hand focus back to it.
  const discardTrigger = useRef<HTMLElement | null>(null);
  const discardPromptId = useId();

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

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const sendable = useMemo(() => rows.filter((row) => row.blockedReason === null), [rows]);
  // A few seconds of new time is not worth a row of its own: it stays unsent
  // and accumulates, so it neither summons the panel nor counts as blocked.
  const blocked = useMemo(
    () => rows.filter((row) => row.blockedReason !== null && row.blockedReason !== 'too-short'),
    [rows],
  );
  const offeredRows = useMemo(
    () => rows.filter((row) => row.blockedReason !== 'too-short'),
    [rows],
  );
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
    setPushedRows(offeredRows);
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

  const discardRow = async (row: RedmineTimeEntryRow) => {
    setDiscarding(true);
    try {
      await redmineApi.timeEntries.discard(row.ticketId, row.date);
      setPushedRows((prev) => prev.filter((r) => rowKey(r) !== rowKey(row)));
      setConfirmDiscard(null);
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not discard that time.');
    } finally {
      setDiscarding(false);
    }
  };

  const keepRow = () => {
    setConfirmDiscard(null);
    discardTrigger.current?.focus();
  };

  const closeModal = () => {
    setOpen(false);
    setResults(null);
    setOverrides({});
    setError(null);
    setConfirmDiscard(null);
  };

  // Nothing to offer: not linked, or nothing unsent beyond a few seconds. Kept
  // mounted while the dialog is open so a push that sends everything can still
  // show its results.
  const hasSomethingToShow = sendable.length > 0 || blocked.length > 0;
  if (!open && (!preview?.connected || !hasSomethingToShow)) return null;
  if (!preview) return null;

  const tableRows = results ? pushedRows : offeredRows;

  const idle = preview.idle;
  // Opens with only blocked rows too, so one can still be marked Never send;
  // the Send button inside needs a sendable row.
  const canOpen = idle && offeredRows.length > 0;

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
            disabled={!canOpen}
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
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((row) => {
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
                      {row.alreadySentSeconds > 0 && (
                        <Text variant="muted" size="xs">
                          new time only · {asClock(row.alreadySentSeconds / 3600)} already sent
                        </Text>
                      )}
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
                          // Text, not a badge: Redmine's reason can be a sentence.
                          <Text size="xs" variant="destructive" className="redmine-push-failure">
                            {failureText(outcome)}
                          </Text>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {/* Anything not sent can be discarded; a sent row is permanent. */}
                      {!outcome?.ok && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Never send #${row.ticketId} on ${row.date} to Redmine`}
                          title="Never send this time to Redmine"
                          disabled={pushing || discarding}
                          onClick={(event) => {
                            discardTrigger.current = event.currentTarget;
                            setConfirmDiscard(row);
                          }}
                        >
                          <FontAwesomeIcon icon={faTrash} className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {confirmDiscard && (
            <Alert
              variant="warning"
              className="redmine-push-discard-confirm mt-3"
              role="alertdialog"
              aria-labelledby={discardPromptId}
            >
              <AlertDescription>
                <Text size="sm" id={discardPromptId}>
                  Never send #{confirmDiscard.ticketId} on {confirmDiscard.date} (
                  {asClock(confirmDiscard.hours)}) to Redmine? The time stays in TimeHuddle; it just
                  won&apos;t be offered here again.
                </Text>
                <ButtonGroup className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    // Focus moves into the prompt, so keyboard and screen-reader
                    // users land on it; the safe choice takes it.
                    autoFocus
                    onClick={keepRow}
                    disabled={discarding}
                  >
                    Keep it
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void discardRow(confirmDiscard)}
                    isLoading={discarding}
                  >
                    Never send
                  </Button>
                </ButtonGroup>
              </AlertDescription>
            </Alert>
          )}

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
