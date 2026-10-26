/**
 * ChangeRequestWalkthrough — Pulse on a timesheet change that's waiting for
 * approval, wherever that pending change is shown.
 *
 * Added after the change is sent, not in the form: a Pulse video goes straight
 * to its destination when it lands, and the request doesn't exist until it's
 * submitted. Once it lands the approver sees it in Timesheet Approvals.
 */
import { Badge, Text } from '@mieweb/ui';
import React from 'react';

import type { TimesheetChangeRequest } from '../../lib/api';
import { PulseControls } from '../pulse-upload/PulseButton';
import { usePulseUpload } from '../pulse-upload/usePulseUpload';

interface ChangeRequestWalkthroughProps {
  request: Pick<TimesheetChangeRequest, 'id' | 'status' | 'videoUrl'>;
  /** Called once the walkthrough has landed on the request, so the host refetches it. */
  onAdded?: () => void;
}

interface ChangeRequestWalkthroughHostProps extends ChangeRequestWalkthroughProps {
  /** Places the walkthrough (null when there's nothing to show); may place it differently on each render. */
  children: (walkthrough: React.ReactNode) => React.ReactNode;
}

/**
 * Holds the walkthrough's upload above wherever it's shown, for a host whose
 * layout moves it (a timesheet row gives it a line of its own on a narrow
 * screen): the buttons remount there, the upload under way doesn't.
 */
export const ChangeRequestWalkthroughHost: React.FC<ChangeRequestWalkthroughHostProps> = ({
  request,
  onAdded,
  children,
}) => {
  if (request.status !== 'pending') return <>{children(null)}</>;
  if (request.videoUrl) {
    return (
      <>
        {children(
          <Badge variant="success" size="sm" className="change-request-walkthrough-added">
            Walkthrough added
          </Badge>,
        )}
      </>
    );
  }
  return (
    <WalkthroughUpload requestId={request.id} onAdded={onAdded}>
      {children}
    </WalkthroughUpload>
  );
};

/** Only mounted while a walkthrough can still be added, so no link is prepared otherwise. */
const WalkthroughUpload: React.FC<{
  requestId: string;
  onAdded?: () => void;
  children: ChangeRequestWalkthroughHostProps['children'];
}> = ({ requestId, onAdded, children }) => {
  const pulse = usePulseUpload(
    { kind: 'timesheet-request', id: requestId },
    {
      onSettled: (status) => {
        if (status.state === 'done') onAdded?.();
      },
    },
  );
  // Named like the form's "Walkthrough" field, so both read as the same thing.
  return (
    <>
      {children(
        <div className="change-request-walkthrough flex flex-wrap items-center gap-x-2 gap-y-1">
          <Text as="span" size="xs" variant="muted">
            Walkthrough
          </Text>
          <PulseControls pulse={pulse} ariaLabel="Add a walkthrough with Pulse" allowFile />
        </div>,
      )}
    </>
  );
};

export const ChangeRequestWalkthrough: React.FC<ChangeRequestWalkthroughProps> = (props) => (
  <ChangeRequestWalkthroughHost {...props}>
    {(walkthrough) => walkthrough}
  </ChangeRequestWalkthroughHost>
);
