/**
 * TimesheetJustificationFields — the written reason a retroactive timesheet
 * change has to carry on a team that reviews them.
 *
 * Rendered inside the existing edit/add/delete modals, so the reason is given
 * in the same breath as the change. A Pulse video walkthrough is added *after*
 * submitting, on the pending request itself (ChangeRequestWalkthrough): a
 * Pulse upload goes straight to its destination, and the request is that
 * destination — it doesn't exist until the change is sent.
 */
import { Text, Textarea } from '@mieweb/ui';
import React from 'react';

import { TIMESHEET_DESCRIPTION_MIN } from '../../lib/timesheetApproval';

export interface TimesheetJustificationState {
  description: string;
}

interface TimesheetJustificationFieldsProps {
  value: TimesheetJustificationState;
  onChange: (next: TimesheetJustificationState) => void;
  disabled?: boolean;
  /** Surfaced so the requester knows who they are waiting on. */
  approverCount: number;
}

export const TimesheetJustificationFields: React.FC<TimesheetJustificationFieldsProps> = ({
  value,
  onChange,
  disabled,
  approverCount,
}) => {
  const remaining = TIMESHEET_DESCRIPTION_MIN - value.description.trim().length;

  return (
    <section
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
      aria-labelledby="timesheet-justification-heading"
    >
      <Text id="timesheet-justification-heading" size="sm" weight="medium">
        Needs approval
      </Text>
      <Text variant="muted" size="xs" className="mt-0.5">
        {approverCount > 1
          ? `One of ${approverCount} admins has to approve this before it takes effect.`
          : 'An admin has to approve this before it takes effect.'}
      </Text>

      <div className="mt-3 space-y-1">
        <label htmlFor="timesheet-justification-note" className="block">
          <Text size="xs" weight="medium">
            Why is this change needed?
          </Text>
        </label>
        <Textarea
          id="timesheet-justification-note"
          rows={3}
          value={value.description}
          disabled={disabled}
          placeholder="e.g. Forgot to clock out after the deploy call ran late."
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          aria-describedby="timesheet-justification-note-hint"
        />
        <Text id="timesheet-justification-note-hint" variant="muted" size="xs" aria-live="polite">
          {remaining > 0 ? `${remaining} more characters needed` : 'Looks good'}
        </Text>
      </div>
    </section>
  );
};

/** Whether the gathered justification satisfies what the server will demand. */
export function isJustificationComplete(value: TimesheetJustificationState): boolean {
  return value.description.trim().length >= TIMESHEET_DESCRIPTION_MIN;
}

export const emptyJustification: TimesheetJustificationState = {
  description: '',
};
