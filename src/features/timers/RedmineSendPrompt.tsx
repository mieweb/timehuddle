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
 * From the keyboard: Enter in the comment sends, Cmd/Ctrl+Enter sends from
 * anywhere in the prompt, and Esc dismisses.
 */
import {
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
  const [activityId, setActivityId] = useState<number | null>(null);
  const [decimalHours, setDecimalHours] = useState(false);

  const issue = timerLabel('redmine', time.ticketId);

  useEffect(() => {
    let current = true;
    redmineApi.timeEntries
      .preview({ ticketId: time.ticketId, date: time.date })
      .then((preview) => {
        if (current) setRow(preview.rows[0] ?? null);
      })
      // Left without the list: the time can still go, under the server's pick.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [time.ticketId, time.date]);

  const finish = () => {
    // The push dialog's summary is now out of date, whichever way this went.
    window.dispatchEvent(new CustomEvent(REDMINE_TIME_SENT_EVENT));
    onDone();
  };

  const send = async () => {
    // The ref is the guard: two key presses can land before the state does,
    // and a sent entry is permanent.
    if (busyRef.current) return;
    busyRef.current = true;
    setSending(true);
    setError(null);
    let outcome;
    try {
      outcome = await redmineApi.timeEntries.sendTicketDay(time.ticketId, time.date, {
        comment: comment.trim() || undefined,
        activityId: activityId ?? undefined,
      });
    } catch (err) {
      // Nothing was decided (a push already running, the network): the prompt
      // stays open with the comment intact, to try again or close.
      setError(err instanceof ApiError && err.message ? err.message : text.redmineSendFailed);
      busyRef.current = false;
      setSending(false);
      return;
    }

    if (outcome.ok) {
      toast.success(
        text.redmineSent(asClock(outcome.hours ?? time.hours), issue, outcome.activityName),
      );
    } else if (outcome.entryId != null) {
      toast.warning(text.redmineSentUnverified(issue, withoutFullStop(failureText(outcome))));
    } else if (outcome.reason === 'already-synced-or-gone') {
      toast.info(text.redmineAlreadySent(issue));
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

  /** Enter in the comment sends. Not mid-composition (IME). */
  const sendOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    // With Cmd/Ctrl held, the document listener above sends.
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    void send();
  };

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
            hours={time.hours}
            decimalHours={decimalHours}
            onToggleHours={() => setDecimalHours((on) => !on)}
            // One entry, and the dialog frames it already.
            bare
          >
            <RedmineEntryField label={entryCardText.activity}>
              <Select
                label={text.redmineSendActivityLabel}
                hideLabel
                size="sm"
                // Only what this issue's project allows.
                options={activityOptions}
                value={String(activityId ?? row?.activityId ?? '')}
                onValueChange={(value) => setActivityId(Number(value))}
                placeholder={row ? undefined : text.redmineSendActivityLoading}
                disabled={sending || activityOptions.length === 0}
                searchable
                searchPlaceholder={text.redmineSendActivitySearch}
                noResultsText={text.redmineSendActivityNoMatch}
              />
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
                onKeyDown={sendOnEnter}
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
            aria-keyshortcuts="Enter Meta+Enter Control+Enter"
          >
            {text.redmineSend}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};
