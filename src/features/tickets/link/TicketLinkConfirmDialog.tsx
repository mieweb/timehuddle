/**
 * Confirms removing a ticket's link to an external issue, and says what happens
 * to the time already logged on it.
 */
import {
  Alert,
  AlertDescription,
  Button,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ticketApi, type Ticket } from '../../../lib/api';

import { linkErrorMessage } from './linkErrors';
import { linkWarnings } from './linkWarnings';
import { ticketLinkText } from './ticketLinkStrings';
import { useLinkStatus } from './useLinkStatus';

export interface TicketLinkConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  ticket: Pick<Ticket, 'id' | 'linkedIssue'>;
  /** Called with the ticket as the server stored it, now unlinked. */
  onChanged: (ticket: Ticket) => void;
}

export function TicketLinkConfirmDialog({
  open,
  onClose,
  ticket,
  onChanged,
}: TicketLinkConfirmDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = useLinkStatus(ticket.id, open);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const linked = ticket.linkedIssue;
  if (!linked) return null;
  const warnings = status ? linkWarnings(status, 'unlink', `#${linked.id}`) : [];

  const handleUnlink = async () => {
    setSaving(true);
    setError(null);
    try {
      onChanged(await ticketApi.unlink(ticket.id, linked.id));
      onClose();
    } catch (err) {
      setError(linkErrorMessage(err, ticketLinkText.unlinkFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(next) => !next && onClose()} size="sm">
      <ModalHeader>
        <ModalTitle>{ticketLinkText.unlinkTitle(`#${linked.id}`)}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div className="ticket-unlink-confirm space-y-3" aria-live="polite">
          <Text size="sm">{ticketLinkText.unlinkBody}</Text>
          {warnings.map((warning) => (
            <Alert key={warning} variant="warning">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
          {error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          {ticketLinkText.cancel}
        </Button>
        <Button
          variant="danger"
          onClick={() => void handleUnlink()}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? ticketLinkText.unlinking : ticketLinkText.unlink}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
