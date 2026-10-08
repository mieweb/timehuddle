/**
 * ChangeRequestWalkthrough — Pulse on a timesheet change that's waiting for
 * approval, wherever that pending change is shown.
 *
 * Added after the change is sent, not in the form: a Pulse video goes straight
 * to its destination when it lands, and the request doesn't exist until it's
 * submitted. Once it lands the approver sees it in Timesheet Approvals.
 */
import { Badge } from '@mieweb/ui';
import React from 'react';

import type { TimesheetChangeRequest } from '../../lib/api';
import { PulseButton } from '../pulse-upload/PulseButton';

interface ChangeRequestWalkthroughProps {
  request: Pick<TimesheetChangeRequest, 'id' | 'status' | 'videoUrl'>;
  /** Called once the walkthrough has landed on the request, so the host refetches it. */
  onAdded?: () => void;
}

export const ChangeRequestWalkthrough: React.FC<ChangeRequestWalkthroughProps> = ({
  request,
  onAdded,
}) => {
  if (request.status !== 'pending') return null;
  if (request.videoUrl) {
    return (
      <Badge variant="success" size="sm" className="change-request-walkthrough-added">
        Walkthrough added
      </Badge>
    );
  }
  return (
    <PulseButton
      destination={{ kind: 'timesheet-request', id: request.id }}
      ariaLabel="Add a walkthrough with Pulse"
      onSettled={(status) => {
        if (status.state === 'done') onAdded?.();
      }}
    />
  );
};
