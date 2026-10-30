/**
 * RedmineEntryCard — one time entry about to go to Redmine.
 *
 * Shared by the two places that send time: the push dialog on the Clock page
 * (one card per ticket-day) and the prompt shown when a ticket timer ends (one
 * entry, so `bare`: the dialog is already its frame). It states what the entry
 * is — the issue, in full, with its hours and day — and its children are what
 * can still be decided about it: the activity, the comment, and in the push
 * dialog whether to send it at all. Each of those sits in a
 * `RedmineEntryField`, which names it.
 */
import { Accordion, Button, Card, Text } from '@mieweb/ui';
import { ArrowLeftRight } from 'lucide-react';
import React from 'react';

import type { RedmineBillable } from '@lib/api';
import { formatTimer } from '@lib/timeUtils';

import {
  billableValueLabel,
  entryCardText as text,
  entryDayLabel,
  hoursLabel,
} from './redminePushStrings';

export interface RedmineEntryCardProps {
  ticketId: string;
  /** The issue's subject. Null while it is unknown, or when Redmine could not supply it. */
  subject: string | null;
  /** The day being logged, `YYYY-MM-DD`. */
  date: string;
  hours: number;
  /** Hours as Redmine stores them (0.15 h) rather than as time worked (0:09). */
  decimalHours: boolean;
  /** A press on the hours switches between the two. */
  onToggleHours: () => void;
  /** The Billable value the entry is sent with, shown read-only; null or absent for none. */
  billable?: RedmineBillable | null;
  /** How `hours` was rounded up from the time worked; null or absent when exact. */
  rounding?: { step: number; exactHours: number } | null;
  /** The seconds of each timer run `hours` adds up; a single run needs no mention. */
  runSeconds?: number[];
  /** No border or padding: for the one entry of a dialog that frames it already. */
  bare?: boolean;
  children?: React.ReactNode;
}

export const RedmineEntryCard: React.FC<RedmineEntryCardProps> = ({
  ticketId,
  subject,
  date,
  hours,
  decimalHours,
  onToggleHours,
  billable = null,
  rounding = null,
  runSeconds = [],
  bare = false,
  children,
}) => {
  const shown = hoursLabel(hours, decimalHours);
  const switchTo = decimalHours ? text.showAsTime : text.showAsRedmineHours;
  const content = (
    <>
      <div className="redmine-entry-head flex items-start justify-between gap-3">
        <Text size="sm" className="redmine-entry-issue min-w-0 break-words">
          <Text as="span" size="sm" weight="medium">
            #{ticketId}
          </Text>
          {subject && ` ${subject}`}
        </Text>
        <div className="redmine-entry-facts flex shrink-0 items-center gap-2">
          {/* Underlined and with the swap mark, so it reads as something to press. */}
          <Button
            variant="ghost"
            size="sm"
            className="redmine-entry-hours h-auto px-1 py-0 text-sm font-medium tabular-nums underline decoration-dotted underline-offset-4 [&_[data-slot=button-label]]:flex [&_[data-slot=button-label]]:items-center [&_[data-slot=button-label]]:gap-1"
            onClick={onToggleHours}
            aria-label={`${shown} on issue ${ticketId}. ${switchTo}`}
            title={switchTo}
          >
            {shown}
            <ArrowLeftRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </Button>
          {/* The day as people say it; the exact date is a hover away. */}
          <Text as="span" size="xs" variant="muted" className="whitespace-nowrap">
            <time dateTime={date} title={date}>
              {entryDayLabel(date)}
            </time>
          </Text>
        </div>
      </div>
      {/* Sessions lists each run, so show why this is one entry. */}
      {runSeconds.length > 1 && <RedmineEntryRuns runSeconds={runSeconds} />}
      {/* Read-only: copied from Redmine's own entries, so it is stated, not chosen. */}
      {billable && (
        <RedmineEntryField label={text.billable}>
          <Text size="sm" className="redmine-entry-billable">
            {/* The field's label is for the eye only; this names it for a screen reader. */}
            <span className="sr-only">{billable.name}: </span>
            {billableValueLabel(billable.value)}
          </Text>
        </RedmineEntryField>
      )}
      {rounding && (
        <RedmineEntryField label={text.rounding}>
          <Text size="sm" className="redmine-entry-rounding">
            {text.roundedUp(hoursLabel(rounding.exactHours, decimalHours), rounding.step)}
          </Text>
        </RedmineEntryField>
      )}
      {children}
    </>
  );

  return bare ? (
    <div className="redmine-entry flex flex-col gap-2">{content}</div>
  ) : (
    <Card padding="sm" className="redmine-entry-card flex flex-col gap-2 shadow-none">
      {content}
    </Card>
  );
};

/** The timer runs an entry adds up, collapsed until asked for. */
const RedmineEntryRuns: React.FC<{ runSeconds: number[] }> = ({ runSeconds }) => (
  <Accordion
    className="redmine-entry-timer-runs"
    headingLevel="h4"
    items={[
      {
        id: 'timer-runs',
        title: (
          <Text as="span" size="xs" variant="muted">
            {text.addsUpRuns(runSeconds.length)}
          </Text>
        ),
        content: (
          <ol className="redmine-entry-timer-run-list flex flex-col gap-1">
            {runSeconds.map((seconds, index) => (
              <li key={index} className="redmine-entry-timer-run flex justify-between gap-3">
                <Text as="span" size="xs" variant="muted">
                  {text.runLabel(index + 1)}
                </Text>
                <Text as="span" size="xs" className="tabular-nums">
                  {formatTimer(seconds)}
                </Text>
              </li>
            ))}
          </ol>
        ),
      },
    ]}
  />
);

/**
 * One thing to decide about an entry, with its name beside it. The name here
 * is for the eye; the control inside carries its own accessible name.
 */
export const RedmineEntryField: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="redmine-entry-field flex items-center gap-2">
    <Text as="span" size="xs" variant="muted" className="w-16 shrink-0" aria-hidden="true">
      {label}
    </Text>
    <div className="redmine-entry-field-control min-w-0 flex-1">{children}</div>
  </div>
);
