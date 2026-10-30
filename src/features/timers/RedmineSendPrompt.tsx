/**
 * RedmineSendPrompt — asked when a timer on a Redmine issue ends (#688).
 *
 * The issue's unsent time for the day goes to Redmine as one entry, under the
 * activity chosen here and with the comment written here, if any. The timer
 * has already stopped, and any next one already started, by the time this
 * opens: it never holds either up.
 *
 * Nothing is sent until Send is pressed. Later, or closing the prompt, leaves
 * the time unsent, where the push dialog on the Clock page offers it as before.
 * A sent entry is permanent, so the activity and the comment have to be asked
 * for now, not afterwards.
 *
 * From the keyboard: Cmd/Ctrl+Enter sends from anywhere in the prompt, and Esc
 * dismisses. Plain Enter does not send: the comment field has focus when the
 * prompt opens, and a sent entry is permanent.
 */
import {
  Badge,
  Button,
  ButtonGroup,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Input,
  Select,
  Text,
  useToast,
} from '@mieweb/ui';
import React, { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  redmineApi,
  type RedmineTimeEntryRow,
  type UnsentRedmineTime,
} from '../../lib/api';
import { RedmineEntryCard, RedmineEntryField } from '../clock/RedmineEntryCard';
import {
  BLOCKED_TEXT,
  REDMINE_COMMENT_MAX_LENGTH,
  REDMINE_TIME_SENT_EVENT,
  asClock,
  entryCardText,
  failureText,
} from '../clock/redminePushStrings';

import { ticketTimerText as text, timerLabel } from './ticketTimerStrings';

/** A reason as a sentence fragment: the messages here end it themselves. */
const withoutFullStop = (reason: string) => reason.replace(/\.$/, '');

interface RedmineSendPromptProps {
  /** The time to send. The parent keys this component on it, so each gets a fresh comment. */
  time: UnsentRedmineTime;
  /** The prompt is finished with, whether the time was sent or left. */
  onDone: () => void;
}

export const RedmineSendPrompt: React.FC<RedmineSendPromptProps> = ({ time, onDone }) => {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // The ticket-day as the server previews it: the activities this issue's
  // project allows, and the one its rules would pick. Null until read, and if
  // the read fails: the time can still be sent, under the server's own pick.
  const [row, setRow] = useState<RedmineTimeEntryRow | null>(null);
  // The read has answered, one way or the other: no longer "loading".
  const [activitiesRead, setActivitiesRead] = useState(false);
  // Bumped to read the preview again, when the server says what was shown has moved.
  const [rereads, setRereads] = useState(0);
  // Why the server will not send this entry (its project allows no activity,
  // or the issue could not be read), when it said so.
  const blockedReason = row?.blockedReason ?? null;
  // Not before the read has answered: a sent entry is permanent, so the
  // activity it goes under is shown first. Not at all for a blocked entry,
  // which the server would only refuse.
  const canSend = activitiesRead && !blockedReason;
  const canSendRef = useRef(canSend);
  canSendRef.current = canSend;
  const [activityId, setActivityId] = useState<number | null>(null);
  const [decimalHours, setDecimalHours] = useState(false);

  const issue = timerLabel('redmine', time.ticketId);

  // Read again when a newer total arrives for this issue-day while the prompt
  // is open, and hold Send until it has answered: the card shows what will go.
  useEffect(() => {
    let current = true;
    setActivitiesRead(false);
    redmineApi.timeEntries
      .preview({ ticketId: time.ticketId, date: time.date })
      .then((preview) => {
        if (current) setRow(preview.rows[0] ?? null);
      })
      // Left without the list: the time can still go, under the server's pick,
      // and the field says so (`redmineSendActivityAuto`).
      .catch(() => {})
      .finally(() => {
        if (current) setActivitiesRead(true);
      });
    return () => {
      current = false;
    };
  }, [time.ticketId, time.date, time.hours, rereads]);

  // What the server will send: its total as just read, else the one from the stop.
  const hours = row?.hours ?? time.hours;

  const finish = () => {
    // The push dialog's summary is now out of date, whichever way this went.
    window.dispatchEvent(new CustomEvent(REDMINE_TIME_SENT_EVENT));
    onDone();
  };

  const send = async () => {
    // The ref is the guard: two key presses can land before the state does,
    // and a sent entry is permanent. The keys obey what the button does.
    if (busyRef.current || !canSendRef.current) return;
    busyRef.current = true;
    setSending(true);
    setError(null);
    let outcome;
    try {
      outcome = await redmineApi.timeEntries.sendTicketDay(time.ticketId, time.date, {
        comment: comment.trim() || undefined,
        // The activity shown, even when left as the default: the server checks
        // it is still allowed, and does not pick again behind the user's back.
        activityId: activityId ?? row?.activityId ?? undefined,
        // The Billable value shown, `null` for none: the server refuses the entry
        // if it moved since. When the preview failed nothing was shown, so a value
        // the server finds on its own is refused, never sent unseen.
        billable: row?.billable ?? null,
      });
    } catch (err) {
      // Nothing was decided (a push already running, the network): the prompt
      // stays open with the comment intact, to try again or close.
      setError(err instanceof ApiError && err.message ? err.message : text.redmineSendFailed);
      busyRef.current = false;
      setSending(false);
      return;
    }

    if (outcome.reason === 'billable-changed') {
      // Nothing was sent. Stay open with the comment, and read the value again
      // so the card shows what a second Send would use.
      setError(text.redmineBillableChanged);
      setRereads((count) => count + 1);
      busyRef.current = false;
      setSending(false);
      return;
    }

    if (outcome.ok) {
      toast.success(text.redmineSent(asClock(outcome.hours ?? hours), issue, outcome.activityName));
    } else if (outcome.entryId != null) {
      toast.warning(text.redmineSentUnverified(issue, withoutFullStop(failureText(outcome))));
    } else if (outcome.reason === 'already-synced-or-gone') {
      toast.info(text.redmineNothingToSend(issue));
    } else {
      toast.error(text.redmineNotSent(issue, withoutFullStop(failureText(outcome))));
    }
    finish();
  };

  // Cmd/Ctrl+Enter sends from wherever focus is in the prompt: the buttons sit
  // outside the comment field, so the key is heard on the document. Only from
  // inside this dialog, though. The same keys pressed anywhere else on the
  // page must never send a permanent entry.
  const bodyRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
      const dialog = bodyRef.current?.closest('[role="dialog"]');
      if (!(event.target instanceof Node) || !dialog?.contains(event.target)) return;
      event.preventDefault();
      void sendRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const activityOptions = (row?.activityOptions ?? []).map((activity) => ({
    value: String(activity.id),
    label: activity.name,
  }));

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !sending) finish();
      }}
      size="sm"
      aria-labelledby="redmine-send-title"
    >
      <ModalHeader>
        <ModalTitle id="redmine-send-title">{text.redmineSendTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div ref={bodyRef} className="redmine-send-body flex flex-col gap-2">
          {/* The same entry the push dialog lists as cards. */}
          <RedmineEntryCard
            ticketId={time.ticketId}
            subject={row?.subject ?? null}
            date={time.date}
            hours={hours}
            decimalHours={decimalHours}
            onToggleHours={() => setDecimalHours((on) => !on)}
            billable={row?.billable}
            runSeconds={row?.runSeconds}
            // One entry, and the dialog frames it already.
            bare
          >
            <RedmineEntryField label={entryCardText.activity}>
              {blockedReason ? (
                // As the push dialog says it. The time waits there, where it
                // can be retried or marked Never send.
                <Badge variant="outline" className="redmine-send-blocked">
                  {BLOCKED_TEXT[blockedReason]}
                </Badge>
              ) : (
                <Select
                  label={text.redmineSendActivityLabel}
                  hideLabel
                  size="sm"
                  // Only what this issue's project allows.
                  options={activityOptions}
                  value={String(activityId ?? row?.activityId ?? '')}
                  onValueChange={(value) => setActivityId(Number(value))}
                  placeholder={
                    !activitiesRead
                      ? text.redmineSendActivityLoading
                      : activityOptions.length === 0
                        ? text.redmineSendActivityAuto
                        : undefined
                  }
                  disabled={sending || activityOptions.length === 0}
                  searchable
                  searchPlaceholder={text.redmineSendActivitySearch}
                  noResultsText={text.redmineSendActivityNoMatch}
                />
              )}
            </RedmineEntryField>
            <RedmineEntryField label={entryCardText.comment}>
              <Input
                label={text.redmineSendCommentLabel}
                hideLabel
                size="sm"
                placeholder={entryCardText.commentPlaceholder}
                maxLength={REDMINE_COMMENT_MAX_LENGTH}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={sending}
                autoFocus
              />
            </RedmineEntryField>
          </RedmineEntryCard>
          <Text size="xs" variant="muted" className="redmine-send-permanent">
            {text.redmineSendPermanent}
          </Text>
          {error && (
            <Text size="xs" className="text-danger" role="alert">
              {error}
            </Text>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        {/* The keys, beside the buttons they stand for. Not on touch, where there are none. */}
        <Text
          as="span"
          size="xs"
          variant="muted"
          className="redmine-send-shortcuts me-auto pointer-coarse:hidden"
        >
          {text.redmineSendShortcuts}
        </Text>
        <ButtonGroup>
          <Button variant="outline" onClick={finish} disabled={sending}>
            {text.redmineSendLater}
          </Button>
          <Button
            variant="primary"
            onClick={() => void send()}
            isLoading={sending}
            disabled={!canSend}
            aria-keyshortcuts="Meta+Enter Control+Enter"
          >
            {text.redmineSend}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};
