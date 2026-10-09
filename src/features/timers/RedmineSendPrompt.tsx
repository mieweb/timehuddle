/**
 * RedmineSendPrompt — asked when a timer on a Redmine issue ends (#688).
 *
 * The issue's unsent time for the day goes to Redmine as one entry, with the
 * comment written here or without one. The timer has already stopped, and any
 * next one already started, by the time this opens: it never holds either up.
 *
 * Nothing is sent until a button is pressed. Closing the prompt leaves the time
 * unsent, where the push dialog on the Clock page offers it as before. A sent
 * entry is permanent, so the comment has to be asked for now, not afterwards.
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
  Text,
  Textarea,
  useToast,
} from '@mieweb/ui';
import React, { useState } from 'react';

import { ApiError, redmineApi, type UnsentRedmineTime } from '../../lib/api';
import { REDMINE_TIME_SENT_EVENT, asClock, failureText } from '../clock/redminePushStrings';

import { ticketTimerText as text, timerLabel } from './ticketTimerStrings';

/** The server's `MAX_COMMENT_LENGTH`: the longest comment Redmine accepts. */
const MAX_COMMENT_LENGTH = 1024;

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
  // Which button is sending, so only that one shows the spinner.
  const [sending, setSending] = useState<'with' | 'without' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issue = timerLabel('redmine', time.ticketId);

  const finish = () => {
    // The push dialog's summary is now out of date, whichever way this went.
    window.dispatchEvent(new CustomEvent(REDMINE_TIME_SENT_EVENT));
    onDone();
  };

  const send = async (withComment: boolean) => {
    setSending(withComment ? 'with' : 'without');
    setError(null);
    let outcome;
    try {
      outcome = await redmineApi.timeEntries.sendTicketDay(
        time.ticketId,
        time.date,
        withComment ? comment.trim() : undefined,
      );
    } catch (err) {
      // Nothing was decided (a push already running, the network): the prompt
      // stays open with the comment intact, to try again or close.
      setError(err instanceof ApiError && err.message ? err.message : text.redmineSendFailed);
      setSending(null);
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
        <div className="redmine-send-body space-y-3">
          <Text size="sm">{text.redmineSendBody(asClock(time.hours), issue)}</Text>
          <Textarea
            label={text.redmineSendCommentLabel}
            placeholder={text.redmineSendCommentPlaceholder}
            rows={3}
            maxLength={MAX_COMMENT_LENGTH}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={sending !== null}
            helperText={text.redmineSendPermanent}
            autoFocus
          />
          {error && (
            <Text size="xs" className="text-danger" role="alert">
              {error}
            </Text>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button
            variant="outline"
            onClick={() => void send(false)}
            isLoading={sending === 'without'}
            disabled={sending !== null}
          >
            {text.redmineSendWithoutComment}
          </Button>
          <Button
            variant="primary"
            onClick={() => void send(true)}
            isLoading={sending === 'with'}
            disabled={sending !== null || !comment.trim()}
          >
            {text.redmineSendWithComment}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
};
