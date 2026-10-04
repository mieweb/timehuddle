/**
 * The "Linked issue" section at the top of a TimeHuddle ticket's page: the one
 * place a ticket's link is shown, changed and removed, whether it points at a
 * Redmine issue or a GitHub URL.
 *
 * A ticket stores only a Redmine issue's number. What is shown about the issue
 * is read from Redmine with the viewer's own key, so a teammate who has not
 * connected Redmine, or cannot see the issue, is told why instead of seeing
 * someone else's view of it.
 *
 * Changing and removing happen in place, with the same control the create
 * dialog uses (`TicketLinkFields`). Before a change is saved, the viewer is
 * told what it means for time already logged (`linkWarnings`).
 */
import { faExternalLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, redmineApi, type RedmineIssue, type Ticket } from '../../../lib/api';
import { useRouter } from '../../../ui/router';
import { ticketDetailPath } from '../sources';

import { IssueCreatedNotLinkedError, applyTicketLink } from './applyTicketLink';
import { linkErrorMessage } from './linkErrors';
import { linkWarnings, type LinkChange } from './linkWarnings';
import { TicketLinkFields } from './TicketLinkFields';
import {
  EMPTY_LINK_FORM,
  linkFormFor,
  linkFormReady,
  linkKindOf,
  type LinkFormState,
} from './ticketLinkForm';
import { ticketLinkText } from './ticketLinkStrings';
import { useLinkStatus } from './useLinkStatus';

export interface LinkedIssueSectionProps {
  ticket: Ticket;
  /** Called with the ticket as the server stored it after its link changed. */
  onChanged: (ticket: Ticket) => void;
  /** Someone is timing the ticket, so its link cannot be changed right now. */
  locked?: boolean;
}

type IssueState =
  | { kind: 'loading' }
  | { kind: 'loaded'; issue: RedmineIssue }
  | { kind: 'not-connected' }
  | { kind: 'unavailable' };

type Mode = 'view' | 'edit' | 'remove';

/** What saving now would do to a Redmine link, for the warnings about time already logged. */
function pendingChange(
  mode: Mode,
  form: LinkFormState,
  linkedId: string | null,
): LinkChange | null {
  if (mode === 'view') return null;
  if (mode === 'edit' && form.kind === 'redmine') return linkedId ? 'relink' : 'link';
  return linkedId ? 'unlink' : null;
}

export function LinkedIssueSection({ ticket, onChanged, locked = false }: LinkedIssueSectionProps) {
  const { navigate } = useRouter();
  const [issueState, setIssueState] = useState<IssueState>({ kind: 'loading' });
  const [mode, setMode] = useState<Mode>('view');
  const [form, setForm] = useState<LinkFormState>(EMPTY_LINK_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linked = ticket.linkedIssue;
  const linkedId = linked?.id ?? null;
  const currentKind = linkKindOf(ticket);
  const status = useLinkStatus(ticket.id, mode !== 'view');

  useEffect(() => {
    if (!linkedId) return;
    let cancelled = false;
    setIssueState({ kind: 'loading' });
    redmineApi.issues
      .get(Number(linkedId))
      .then(({ issue }) => !cancelled && setIssueState({ kind: 'loaded', issue }))
      .catch((err) => {
        if (cancelled) return;
        const notConnected = err instanceof ApiError && err.code === 'not-connected';
        setIssueState({ kind: notConnected ? 'not-connected' : 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [linkedId]);

  const open = (next: Mode) => {
    setError(null);
    setForm(linkFormFor(ticket));
    setMode(next);
  };

  const run = async (target: LinkFormState) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await applyTicketLink(ticket, target);
      if (updated) onChanged(updated);
      setMode('view');
    } catch (err) {
      if (err instanceof IssueCreatedNotLinkedError) {
        // The issue exists now: offer to link it rather than create another.
        setForm((current) => ({
          ...current,
          redmineMode: 'existing',
          query: `#${err.issue.id}`,
          issue: err.issue,
        }));
        setError(ticketLinkText.createdNotLinked(`#${err.issue.id}`));
      } else {
        setError(linkErrorMessage(err, ticketLinkText.linkFailed));
      }
    } finally {
      setSaving(false);
    }
  };

  const change = pendingChange(mode, form, linkedId);
  const warnings =
    status && change ? linkWarnings(status, change, linkedId ? `#${linkedId}` : '') : [];

  const ref = linked ? `#${linked.id}` : '';

  return (
    <Card>
      <CardContent className="ticket-linked-issue space-y-3">
        <div className="ticket-linked-issue-header flex flex-wrap items-center justify-between gap-2">
          <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
            {ticketLinkText.sectionTitle}
          </Text>
          {mode === 'view' && (
            <div className="ticket-linked-issue-actions flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={locked} onClick={() => open('edit')}>
                {currentKind === 'none' ? ticketLinkText.add : ticketLinkText.change}
              </Button>
              {currentKind !== 'none' && (
                <Button variant="ghost" size="sm" disabled={locked} onClick={() => open('remove')}>
                  {ticketLinkText.remove}
                </Button>
              )}
            </div>
          )}
        </div>

        {mode !== 'edit' && currentKind === 'none' && (
          <Text size="sm" variant="muted">
            {ticketLinkText.notLinked}
          </Text>
        )}

        {mode !== 'edit' && currentKind === 'github' && (
          <div className="ticket-linked-github flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm">
              {ticketLinkText.github}
            </Badge>
            <a
              href={ticket.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={ticketLinkText.openGithub(ticket.github)}
              className="inline-flex min-w-0 items-center gap-1.5 break-all text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              <FontAwesomeIcon icon={faExternalLink} className="h-3 w-3 shrink-0" />
              {ticket.github}
            </a>
          </div>
        )}

        {mode !== 'edit' && linked && (
          <div className="ticket-linked-redmine space-y-2" aria-live="polite">
            <div className="ticket-linked-redmine-meta flex flex-wrap items-center gap-2">
              <Badge variant="outline" size="sm">
                {ticketLinkText.redmine}
              </Badge>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 font-mono"
                aria-label={ticketLinkText.openIssue(ref)}
                onClick={() =>
                  navigate(ticketDetailPath({ sourceId: linked.source, id: linked.id }))
                }
              >
                {ref}
              </Button>
              {issueState.kind === 'loaded' && issueState.issue.status && (
                <Badge
                  size="sm"
                  variant={issueState.issue.status.isClosed ? 'secondary' : 'success'}
                >
                  {issueState.issue.status.name}
                </Badge>
              )}
              {issueState.kind === 'loaded' && (
                <Text size="sm" variant="muted">
                  {issueState.issue.assignedTo
                    ? ticketLinkText.assignedTo(issueState.issue.assignedTo.name)
                    : ticketLinkText.unassigned}
                </Text>
              )}
            </div>

            {issueState.kind === 'loading' && (
              <Spinner size="sm" label={ticketLinkText.loadingIssue} />
            )}
            {issueState.kind === 'loaded' && <Text size="sm">{issueState.issue.subject}</Text>}
            {issueState.kind === 'not-connected' && (
              <>
                <Text size="sm" variant="muted">
                  {ticketLinkText.notConnected}
                </Text>
                <Button variant="outline" size="sm" onClick={() => navigate('/app/settings')}>
                  {ticketLinkText.goToSettings}
                </Button>
              </>
            )}
            {issueState.kind === 'unavailable' && (
              <Text size="sm" variant="muted">
                {ticketLinkText.issueUnavailable}
              </Text>
            )}
          </div>
        )}

        {mode === 'edit' && (
          <TicketLinkFields
            name="ticket-link"
            value={form}
            disabled={saving}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
          />
        )}

        {mode === 'remove' && <Text size="sm">{ticketLinkText.removeConfirm}</Text>}

        <div className="ticket-linked-issue-notices space-y-2" aria-live="polite">
          {mode !== 'view' &&
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
        </div>

        {mode !== 'view' && (
          <div className="ticket-linked-issue-confirm flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setMode('view')}>
              {ticketLinkText.cancel}
            </Button>
            {mode === 'edit' && (
              <Button
                variant="primary"
                size="sm"
                disabled={saving || !linkFormReady(form)}
                aria-busy={saving}
                onClick={() => void run(form)}
              >
                {saving ? ticketLinkText.saving : ticketLinkText.save}
              </Button>
            )}
            {mode === 'remove' && (
              <Button
                variant="danger"
                size="sm"
                disabled={saving}
                aria-busy={saving}
                onClick={() => void run(EMPTY_LINK_FORM)}
              >
                {saving ? ticketLinkText.removing : ticketLinkText.removeAction}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
