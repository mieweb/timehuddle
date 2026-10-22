import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import {
  Alert,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Text,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, orgApi, type SourcePrefix } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';

export const TICKET_IDS_STRINGS = {
  title: 'Ticket IDs',
  description:
    'Every ticket in this organization is shown with this prefix and its number, the same in every team.',
  prefixLabel: 'Ticket prefix',
  prefixHelp: (prefix: string) =>
    `A letter, then up to five letters or digits. Tickets show as ${prefix || 'TH'}-12.`,
  serversTitle: 'Outside servers',
  serversDescription:
    'Name the servers your issues live on, so an issue there shows as its prefix and number, such as PM-233. GitHub issues need no setup: they show as the repository and number, such as timehuddle-223.',
  serverLabel: (row: number) => `Server address, row ${row}`,
  serverPlaceholder: 'redmine.example.com',
  serverPrefixLabel: (row: number) => `Prefix, row ${row}`,
  serverPrefixPlaceholder: 'PM',
  removeServer: (host: string) => (host ? `Remove ${host}` : 'Remove this server'),
  addServer: 'Add server',
  noServers: 'No servers named yet.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  saveFailed: 'The change could not be saved.',
} as const;

interface ServerDraft extends SourcePrefix {
  key: number;
}

let nextDraftKey = 0;
const toDrafts = (entries: SourcePrefix[]): ServerDraft[] =>
  entries.map((entry) => ({ ...entry, key: nextDraftKey++ }));

/** One save at a time, with its error and a "Saved." to announce. */
function useSaver() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      await task();
      setStatus(TICKET_IDS_STRINGS.saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : TICKET_IDS_STRINGS.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  return { saving, error, status, clearStatus: () => setStatus(null), run };
}

interface TicketIdsCardProps {
  orgId: string;
  ticketPrefix: string;
  sourcePrefixes: SourcePrefix[];
}

/**
 * The organization's ticket prefix (`TH` in `TH-12`) and the servers it names
 * (`PM` in `PM-233`). Shown to org owners only.
 */
export const TicketIdsCard: React.FC<TicketIdsCardProps> = ({
  orgId,
  ticketPrefix,
  sourcePrefixes,
}) => {
  const { refetchTeams, refetchOrganizations } = useTeam();
  const prefixSave = useSaver();
  const serversSave = useSaver();
  const [savedPrefix, setSavedPrefix] = useState(ticketPrefix);
  const [prefixDraft, setPrefixDraft] = useState(ticketPrefix);
  const [servers, setServers] = useState(() => toDrafts(sourcePrefixes));
  const [serversChanged, setServersChanged] = useState(false);

  useEffect(() => {
    setSavedPrefix(ticketPrefix);
    setPrefixDraft(ticketPrefix);
    setServers(toDrafts(sourcePrefixes));
    setServersChanged(false);
  }, [orgId, ticketPrefix, sourcePrefixes]);

  const normalizedPrefix = prefixDraft.trim().toUpperCase();

  const savePrefix = (event: React.FormEvent) => {
    event.preventDefault();
    void prefixSave.run(async () => {
      const next = await orgApi.setTicketPrefix(orgId, normalizedPrefix);
      setSavedPrefix(next);
      setPrefixDraft(next);
      // Teams carry the prefix, so ticket lists relabel when they arrive.
      refetchTeams();
    });
  };

  const saveServers = (event: React.FormEvent) => {
    event.preventDefault();
    void serversSave.run(async () => {
      const saved = await orgApi.setSourcePrefixes(
        orgId,
        servers.map(({ host, prefix }) => ({ host, prefix })),
      );
      setServers(toDrafts(saved));
      setServersChanged(false);
      // The org list carries the servers, so ticket lists relabel when it arrives.
      refetchOrganizations();
    });
  };

  const editServers = (next: ServerDraft[]) => {
    setServers(next);
    setServersChanged(true);
    serversSave.clearStatus();
  };

  const updateServer = (key: number, field: keyof SourcePrefix, value: string) =>
    editServers(servers.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  return (
    <Card padding="lg" className="org-ticket-ids space-y-4">
      <CardHeader>
        <CardTitle>{TICKET_IDS_STRINGS.title}</CardTitle>
        <Text variant="muted" size="sm">
          {TICKET_IDS_STRINGS.description}
        </Text>
      </CardHeader>
      <CardContent className="space-y-6">
        {prefixSave.error && <Alert variant="danger">{prefixSave.error}</Alert>}
        <form className="org-ticket-prefix-form space-y-1" onSubmit={savePrefix}>
          <div className="org-ticket-prefix-row flex flex-wrap items-end gap-3">
            <div className="org-ticket-prefix-field w-48">
              <Input
                label={TICKET_IDS_STRINGS.prefixLabel}
                aria-describedby="org-ticket-prefix-help"
                value={prefixDraft}
                maxLength={6}
                autoComplete="off"
                disabled={prefixSave.saving}
                onChange={(event) => {
                  setPrefixDraft(event.target.value);
                  prefixSave.clearStatus();
                }}
              />
            </div>
            <Button
              type="submit"
              disabled={prefixSave.saving || !normalizedPrefix || normalizedPrefix === savedPrefix}
            >
              {prefixSave.saving ? TICKET_IDS_STRINGS.saving : TICKET_IDS_STRINGS.save}
            </Button>
            <Text variant="muted" size="sm" role="status" aria-live="polite">
              {prefixSave.status}
            </Text>
          </div>
          {/* Below the row, not under the narrow field, so Save lines up with the input. */}
          <Text id="org-ticket-prefix-help" variant="muted" size="xs">
            {TICKET_IDS_STRINGS.prefixHelp(normalizedPrefix)}
          </Text>
        </form>

        <form
          className="org-ticket-servers-form space-y-3"
          aria-labelledby="org-ticket-servers-title"
          onSubmit={saveServers}
        >
          <div className="org-ticket-servers-heading">
            <Text id="org-ticket-servers-title" size="sm" weight="medium">
              {TICKET_IDS_STRINGS.serversTitle}
            </Text>
            <Text variant="muted" size="xs">
              {TICKET_IDS_STRINGS.serversDescription}
            </Text>
          </div>
          {serversSave.error && <Alert variant="danger">{serversSave.error}</Alert>}
          {servers.length === 0 && (
            <Text variant="muted" size="sm">
              {TICKET_IDS_STRINGS.noServers}
            </Text>
          )}
          {servers.map((row, index) => (
            <div key={row.key} className="org-ticket-server-row flex flex-wrap items-center gap-2">
              <div className="org-ticket-server-host min-w-0 flex-1 basis-56">
                <Input
                  label={TICKET_IDS_STRINGS.serverLabel(index + 1)}
                  hideLabel
                  placeholder={TICKET_IDS_STRINGS.serverPlaceholder}
                  value={row.host}
                  autoComplete="off"
                  disabled={serversSave.saving}
                  onChange={(event) => updateServer(row.key, 'host', event.target.value)}
                />
              </div>
              <div className="org-ticket-server-prefix w-24">
                <Input
                  label={TICKET_IDS_STRINGS.serverPrefixLabel(index + 1)}
                  hideLabel
                  placeholder={TICKET_IDS_STRINGS.serverPrefixPlaceholder}
                  value={row.prefix}
                  maxLength={6}
                  autoComplete="off"
                  disabled={serversSave.saving}
                  onChange={(event) => updateServer(row.key, 'prefix', event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={TICKET_IDS_STRINGS.removeServer(row.host)}
                disabled={serversSave.saving}
                onClick={() => editServers(servers.filter((other) => other.key !== row.key))}
              >
                <FontAwesomeIcon icon={faTrash} className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="org-ticket-servers-actions flex flex-wrap items-center gap-3">
            <ButtonGroup>
              <Button
                type="button"
                variant="outline"
                disabled={serversSave.saving}
                onClick={() => editServers([...servers, ...toDrafts([{ host: '', prefix: '' }])])}
              >
                <FontAwesomeIcon icon={faPlus} className="me-1.5 h-3 w-3" aria-hidden="true" />
                {TICKET_IDS_STRINGS.addServer}
              </Button>
              <Button type="submit" disabled={serversSave.saving || !serversChanged}>
                {serversSave.saving ? TICKET_IDS_STRINGS.saving : TICKET_IDS_STRINGS.save}
              </Button>
            </ButtonGroup>
            <Text variant="muted" size="sm" role="status" aria-live="polite">
              {serversSave.status}
            </Text>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
