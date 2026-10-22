import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, orgApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';

export const TICKET_IDS_STRINGS = {
  title: 'Ticket IDs',
  description:
    'Every ticket in this organization is shown with this prefix and its number, the same in every team.',
  prefixLabel: 'Ticket prefix',
  prefixHelp: (prefix: string) =>
    `A letter, then up to five letters or digits. Tickets show as ${prefix || 'TH'}-12.`,
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  saveFailed: 'The ticket prefix could not be saved.',
} as const;

interface TicketIdsCardProps {
  orgId: string;
  ticketPrefix: string;
}

/** The organization's ticket prefix (`TH` in `TH-12`). Shown to org owners only. */
export const TicketIdsCard: React.FC<TicketIdsCardProps> = ({ orgId, ticketPrefix }) => {
  const { refetchTeams } = useTeam();
  const [saved, setSaved] = useState(ticketPrefix);
  const [draft, setDraft] = useState(ticketPrefix);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setSaved(ticketPrefix);
    setDraft(ticketPrefix);
  }, [orgId, ticketPrefix]);

  const normalized = draft.trim().toUpperCase();

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const next = await orgApi.setTicketPrefix(orgId, normalized);
      setSaved(next);
      setDraft(next);
      setStatus(TICKET_IDS_STRINGS.saved);
      // Teams carry the prefix, so every ticket list relabels on the next fetch.
      refetchTeams();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : TICKET_IDS_STRINGS.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="lg" className="org-ticket-ids space-y-4">
      <CardHeader>
        <CardTitle>{TICKET_IDS_STRINGS.title}</CardTitle>
        <Text variant="muted" size="sm">
          {TICKET_IDS_STRINGS.description}
        </Text>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert variant="danger">{error}</Alert>}
        <form
          className="org-ticket-prefix-form flex flex-wrap items-end gap-3"
          onSubmit={(event) => void save(event)}
        >
          <div className="org-ticket-prefix-field w-48">
            <Input
              label={TICKET_IDS_STRINGS.prefixLabel}
              helperText={TICKET_IDS_STRINGS.prefixHelp(normalized)}
              value={draft}
              maxLength={6}
              autoComplete="off"
              disabled={saving}
              onChange={(event) => {
                setDraft(event.target.value);
                setStatus(null);
              }}
            />
          </div>
          <Button type="submit" disabled={saving || !normalized || normalized === saved}>
            {saving ? TICKET_IDS_STRINGS.saving : TICKET_IDS_STRINGS.save}
          </Button>
          <Text variant="muted" size="sm" role="status" aria-live="polite">
            {status}
          </Text>
        </form>
      </CardContent>
    </Card>
  );
};
