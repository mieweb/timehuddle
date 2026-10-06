/**
 * The Attachments card on a ticket page: links, plus a video recorded with
 * Pulse (the Pulse button in the panel's header). Shared by the Huddle ticket
 * and Redmine issue pages. Either way the attachments are stored in
 * TimeHuddle — a Redmine issue's never reach Redmine.
 */
import { Card, CardContent, Text } from '@mieweb/ui';
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
        <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
          Attachments
        </Text>
        <AttachmentsPanel kind={kind} entityId={ticketId} currentUserId={user?.id} />
      </CardContent>
    </Card>
  );
};
