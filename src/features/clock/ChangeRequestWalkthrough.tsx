/**
 * ChangeRequestWalkthrough — "Add a Pulse walkthrough" on a timesheet change
 * that's waiting for approval, shown wherever that pending change appears.
 *
 * The walkthrough is added after the change is sent, not in the form: a Pulse
 * upload goes straight to its destination when it lands, and the request is
 * that destination (it doesn't exist until submitted). Once it lands the
 * approver sees it in Timesheet Approvals; nothing else to do here.
 */
import { faCircleCheck } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Text } from '@mieweb/ui';
import React from 'react';

import type { TimesheetChangeRequest } from '../../lib/api';
import { PulseButton } from '../pulse-upload/PulseButton';

interface ChangeRequestWalkthroughProps {
  request: Pick<TimesheetChangeRequest, 'id' | 'status' | 'videoUrl'>;
  /**
   * Called once the walkthrough has been added (hosts refetch the request).
   * Not when it was kept in the library instead: the button stays, saying why.
   */
  onAdded?: () => void;
}

export const ChangeRequestWalkthrough: React.FC<ChangeRequestWalkthroughProps> = ({
  request,
  onAdded,
}) => {
  if (request.status !== 'pending') return null;
  if (request.videoUrl) {
    return (
      <span className="change-request-walkthrough-added inline-flex items-center gap-1">
        <FontAwesomeIcon
          icon={faCircleCheck}
          className="text-green-600 dark:text-green-500"
          aria-hidden="true"
        />
        <Text as="span" size="xs">
          Walkthrough added
        </Text>
      </span>
    );
  }
  return (
    <PulseButton
      destination={{ kind: 'timesheet-request', id: request.id }}
      ariaLabel="Add a Pulse video walkthrough for the approver"
      onSettled={(status) => status.state === 'done' && onAdded?.()}
    />
  );
};
