/**
 * The Videos card on a ticket page: Pulse and Upload in its header, the
 * ticket's videos below (see AttachmentsPanel). Shared by the Huddle ticket and
 * Redmine issue pages. Either way the videos are stored in TimeHuddle — a
 * Redmine issue's never reach Redmine. A link goes in the description.
 */
import { Card, CardContent } from '@mieweb/ui';
import React from 'react';

import type { TicketAttachmentKind } from '../../../lib/api';
import { useSession } from '../../../lib/useSession';
import { AttachmentsPanel } from '../../clock/AttachmentsPanel';

interface TicketAttachmentsCardProps {
  kind: TicketAttachmentKind;
  ticketId: string;
}

export const TicketAttachmentsCard: React.FC<TicketAttachmentsCardProps> = ({ kind, ticketId }) => {
  const { user } = useSession();

  return (
    <Card>
      <CardContent className="ticket-attachments-section">
        <AttachmentsPanel kind={kind} entityId={ticketId} currentUserId={user?.id} />
      </CardContent>
    </Card>
  );
};
