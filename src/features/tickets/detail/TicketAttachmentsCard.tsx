/**
 * The Videos card on a ticket page: Pulse and Upload in its header, the
 * ticket's videos below (see AttachmentsPanel). Shared by the Huddle ticket and
 * Redmine issue pages. Either way the videos are stored in TimeHuddle — a
 * Redmine issue's never reach Redmine. A link goes in the description.
 *
 * In the app with Pulse built in, the header's button is "Record with Pulse"
 * for this ticket (`ticket.video`), with the ticket's unsent videos beside it
 * and its videos on their way above the list (PLAN §5.1 flow A).
 */
import { Card, CardContent } from '@mieweb/ui';
import React from 'react';

import type { TicketAttachmentKind } from '../../../lib/api';
import { useSession } from '../../../lib/useSession';
import { AttachmentsPanel } from '../../clock/AttachmentsPanel';

interface TicketAttachmentsCardProps {
  kind: TicketAttachmentKind;
  ticketId: string;
  /** What Pulse calls the ticket ("Sending to Fix login"); without it, "Ticket". */
  title?: string;
  /** The ticket's team, whose "Pulse in the app" setting applies; without it, any of the person's. */
  teamId?: string | null;
}

export const TicketAttachmentsCard: React.FC<TicketAttachmentsCardProps> = ({
  kind,
  ticketId,
  title = '',
  teamId = null,
}) => {
  const { user } = useSession();

  return (
    <Card>
      <CardContent className="ticket-attachments-section">
        <AttachmentsPanel
          kind={kind}
          entityId={ticketId}
          currentUserId={user?.id}
          place={{ type: 'ticket.video', ticketId, label: title }}
          teamId={teamId}
        />
      </CardContent>
    </Card>
  );
};
