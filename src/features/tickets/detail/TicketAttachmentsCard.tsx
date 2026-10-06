/**
 * The Attachments card on a ticket page: links, plus a video uploaded with
 * Pulse. Shared by the Huddle ticket and Redmine issue pages. Either way the
 * attachments are stored in TimeHuddle — a Redmine issue's never reach Redmine.
 */
import { Card, CardContent, Text } from '@mieweb/ui';
import React, { useState } from 'react';

import type { TicketAttachmentKind } from '../../../lib/api';
import { useSession } from '../../../lib/useSession';
import { AttachmentsPanel } from '../../clock/AttachmentsPanel';
import { PulseButton } from '../../pulse-upload/PulseButton';

interface TicketAttachmentsCardProps {
  kind: TicketAttachmentKind;
  ticketId: string;
}

export const TicketAttachmentsCard: React.FC<TicketAttachmentsCardProps> = ({ kind, ticketId }) => {
  const { user } = useSession();
  const [refresh, setRefresh] = useState(0);

  return (
    <Card>
      <CardContent className="ticket-attachments-section">
        <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
          Attachments
        </Text>
        <AttachmentsPanel key={refresh} kind={kind} entityId={ticketId} currentUserId={user?.id} />
        <PulseButton
          destination={{ kind, id: ticketId }}
          ariaLabel="Add a video with Pulse"
          deviceUpload
          onSettled={(status) => status.state === 'done' && setRefresh((n) => n + 1)}
        />
      </CardContent>
    </Card>
  );
};
