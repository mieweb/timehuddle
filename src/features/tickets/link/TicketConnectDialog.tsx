/**
 * "Connect to…" — link a TimeHuddle ticket to an external issue.
 *
 * Three ways in: an existing Redmine issue (by number or pasted link, previewed
 * before it is linked), a new Redmine issue created from the ticket, or a
 * GitHub URL. Opened on a ticket that is already linked, it moves the link.
 *
 * Linking runs on the server under the user's own Redmine key, so only an
 * issue they can see can be linked. Nothing typed here is stored in the
 * browser: a search term may be a patient's name.
 */
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { redmineApi, ticketApi, type RedmineIssue, type Ticket } from '../../../lib/api';
import { useRedmineStatus } from '../../../lib/useRedmineStatus';
import { useRouter } from '../../../ui/router';
import { RedmineIssueCreateModal } from '../redmine/RedmineIssueCreateModal';
import { prefillFromTicket, redmineErrorMessage } from '../redmine/redmineForm';

import { linkErrorMessage } from './linkErrors';
import { linkWarnings } from './linkWarnings';
import { ticketLinkText } from './ticketLinkStrings';
import { useLinkStatus } from './useLinkStatus';

/** The ticket fields the dialog reads: enough to link it and to pre-fill a new issue. */
export type ConnectableTicket = Pick<
  Ticket,
  'id' | 'title' | 'description' | 'priority' | 'github' | 'linkedIssue'
>;

export interface TicketConnectDialogProps {
  open: boolean;
  onClose: () => void;
  ticket: ConnectableTicket;
  /** Called with the ticket as the server stored it after a link or GitHub change. */
  onChanged: (ticket: Ticket) => void;
}

type ConnectTab = 'existing' | 'new' | 'github';

export function TicketConnectDialog({
  open,
  onClose,
  ticket,
  onChanged,
}: TicketConnectDialogProps) {
  const { navigate } = useRouter();
  const redmineStatus = useRedmineStatus();
  const redmineMissing = redmineStatus?.connected === false;

  const [tab, setTab] = useState<ConnectTab>('existing');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [preview, setPreview] = useState<RedmineIssue | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // A Redmine issue that was created but could not be linked, kept for a retry.
  const [createdIssueId, setCreatedIssueId] = useState<number | null>(null);
  const [github, setGithub] = useState('');

  const linkedId = ticket.linkedIssue?.id ?? null;
  const status = useLinkStatus(ticket.id, open);
  const warnings = status
    ? linkWarnings(status, linkedId ? 'relink' : 'link', linkedId ? `#${linkedId}` : '')
    : [];

  // Fresh state each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTab('existing');
    setQuery('');
    setPreview(null);
    setSearchMessage(null);
    setError(null);
    setCreating(false);
    setCreatedIssueId(null);
    setGithub(ticket.github);
  }, [open, ticket.github]);

  const findIssue = async () => {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    setPreview(null);
    setSearchMessage(null);
    setError(null);
    try {
      const result = await redmineApi.issues.search(text);
      const issue = result.issues[0];
      if (result.kind !== 'id' && result.kind !== 'url') {
        setSearchMessage(ticketLinkText.needNumberOrLink);
      } else if (!issue) {
        setSearchMessage(ticketLinkText.notFound);
      } else if (String(issue.id) === linkedId) {
        setSearchMessage(ticketLinkText.alreadyLinked);
      } else {
        setPreview(issue);
      }
    } catch (err) {
      setError(redmineErrorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  // `justCreated`: the issue was made in Redmine a moment ago and exists whatever
  // happens here, so a failed link keeps its number and offers a retry instead
  // of a second create.
  const linkTo = async (issueId: number, justCreated = false) => {
    setSaving(true);
    setError(null);
    try {
      onChanged(await ticketApi.link(ticket.id, issueId, linkedId));
      onClose();
    } catch (err) {
      if (justCreated) setCreatedIssueId(issueId);
      setError(linkErrorMessage(err, ticketLinkText.linkFailed));
    } finally {
      setSaving(false);
    }
  };

  const saveGithub = async () => {
    setSaving(true);
    setError(null);
    try {
      onChanged(await ticketApi.updateTicket(ticket.id, { github: github.trim() }));
      onClose();
    } catch (err) {
      setError(linkErrorMessage(err, ticketLinkText.linkFailed));
    } finally {
      setSaving(false);
    }
  };

  const redmineNeeded = (
    <div className="ticket-connect-redmine-needed space-y-3">
      <Alert variant="warning">
        <AlertDescription>{ticketLinkText.redmineNeeded}</AlertDescription>
      </Alert>
      <Button variant="outline" size="sm" onClick={() => navigate('/app/settings')}>
        {ticketLinkText.goToSettings}
      </Button>
    </div>
  );

  return (
    <>
      <Modal open={open && !creating} onOpenChange={(next) => !next && onClose()} size="lg">
        <ModalHeader>
          <ModalTitle>
            {linkedId ? ticketLinkText.dialogTitleChange : ticketLinkText.dialogTitle}
          </ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="ticket-connect space-y-4">
            <div className="ticket-connect-messages space-y-2" aria-live="polite">
              {linkedId && tab !== 'github' && (
                <Alert variant="info">
                  <AlertDescription>{ticketLinkText.replaces(`#${linkedId}`)}</AlertDescription>
                </Alert>
              )}
              {tab !== 'github' &&
                warnings.map((warning) => (
                  <Alert key={warning} variant="warning">
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
              {error && (
                <Alert variant="danger" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {createdIssueId !== null && (
                <Alert variant="warning">
                  <AlertDescription>
                    {ticketLinkText.createdNotLinked(`#${createdIssueId}`)}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {createdIssueId !== null ? (
              <Button
                variant="primary"
                onClick={() => void linkTo(createdIssueId)}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? ticketLinkText.linking : ticketLinkText.retryLink}
              </Button>
            ) : (
              <Tabs value={tab} onValueChange={(value) => setTab(value as ConnectTab)}>
                <TabsList aria-label={ticketLinkText.tabsLabel}>
                  <TabsTrigger value="existing">{ticketLinkText.tabExisting}</TabsTrigger>
                  <TabsTrigger value="new">{ticketLinkText.tabNew}</TabsTrigger>
                  <TabsTrigger value="github">{ticketLinkText.tabGithub}</TabsTrigger>
                </TabsList>

                <TabsContent value="existing" className="ticket-connect-existing space-y-3 pt-4">
                  {redmineMissing ? (
                    redmineNeeded
                  ) : (
                    <>
                      {/* Plain <form>: @mieweb/ui has no Form primitive, and this gives Enter-to-find. */}
                      <form
                        className="ticket-connect-find flex items-end gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void findIssue();
                        }}
                      >
                        <div className="ticket-connect-find-field flex-1">
                          <Input
                            label={ticketLinkText.existingLabel}
                            placeholder={ticketLinkText.existingPlaceholder}
                            value={query}
                            autoComplete="off"
                            onChange={(e) => {
                              setQuery(e.target.value);
                              setPreview(null);
                              setSearchMessage(null);
                            }}
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={!query.trim() || searching}
                          aria-busy={searching}
                        >
                          {searching ? ticketLinkText.finding : ticketLinkText.find}
                        </Button>
                      </form>

                      <div className="ticket-connect-result space-y-3" aria-live="polite">
                        {searchMessage && (
                          <Text size="sm" variant="muted">
                            {searchMessage}
                          </Text>
                        )}
                        {preview && (
                          <>
                            <div
                              className="ticket-connect-preview rounded-md border border-neutral-200 p-3 dark:border-neutral-700"
                              role="group"
                              aria-label={ticketLinkText.previewLabel}
                            >
                              <div className="ticket-connect-preview-meta flex flex-wrap items-center gap-2">
                                <Text size="sm" variant="muted" className="font-mono">
                                  #{preview.id}
                                </Text>
                                {preview.status && (
                                  <Badge
                                    size="sm"
                                    variant={preview.status.isClosed ? 'secondary' : 'success'}
                                  >
                                    {preview.status.name}
                                  </Badge>
                                )}
                                {preview.project && (
                                  <Text size="sm" variant="muted">
                                    {preview.project.name}
                                  </Text>
                                )}
                              </div>
                              <Text size="sm" className="mt-1 font-medium">
                                {preview.subject}
                              </Text>
                            </div>
                            <Button
                              variant="primary"
                              onClick={() => void linkTo(preview.id)}
                              disabled={saving}
                              aria-busy={saving}
                            >
                              {saving
                                ? ticketLinkText.linking
                                : ticketLinkText.linkTo(`#${preview.id}`)}
                            </Button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="new" className="ticket-connect-new space-y-3 pt-4">
                  {redmineMissing ? (
                    redmineNeeded
                  ) : (
                    <>
                      <Text size="sm">{ticketLinkText.newIntro}</Text>
                      <Button variant="primary" onClick={() => setCreating(true)} disabled={saving}>
                        {saving ? ticketLinkText.linking : ticketLinkText.newAction}
                      </Button>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="github" className="ticket-connect-github space-y-3 pt-4">
                  <Input
                    label={ticketLinkText.githubLabel}
                    type="url"
                    placeholder={ticketLinkText.githubPlaceholder}
                    helperText={ticketLinkText.githubHelp}
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    onClick={() => void saveGithub()}
                    disabled={saving || github.trim() === ticket.github}
                    aria-busy={saving}
                  >
                    {saving ? ticketLinkText.saving : ticketLinkText.save}
                  </Button>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            {createdIssueId !== null ? ticketLinkText.close : ticketLinkText.cancel}
          </Button>
        </ModalFooter>
      </Modal>

      <RedmineIssueCreateModal
        open={open && creating}
        onClose={() => setCreating(false)}
        onCreated={(issueId) => void linkTo(issueId, true)}
        initialValues={prefillFromTicket(ticket)}
      />
    </>
  );
}
