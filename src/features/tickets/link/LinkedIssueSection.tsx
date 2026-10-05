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
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  ExternalLinkIcon,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, redmineApi, type RedmineIssue, type Ticket } from '../../../lib/api';
import { useRouter } from '../../../ui/router';
import { fetchGithubIssueTitle, isGithubIssueUrl, parseGithubIssueUrl } from '../githubIssue';

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
  | { kind: 'loaded'; issue: RedmineIssue; /** The issue's page in Redmine. */ url: string | null }
  | { kind: 'not-connected' }
  | { kind: 'unavailable' };

type Mode = 'view' | 'edit' | 'remove';

/** The linked issue reads as one hyperlink: its reference, its title, and an external-link mark. */
const LINK_CLASS =
  'ticket-linked-issue-link inline-flex max-w-full items-baseline gap-1.5 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400';

/** `owner/repo#12` for a GitHub issue or pull request URL, else the URL itself. */
function githubLabel(url: string): string {
  const parts = parseGithubIssueUrl(url);
  return parts ? `${parts.owner}/${parts.repo}#${parts.number}` : url;
}

/** Which system the link points at, as a filled badge so it does not read as a button. */
function SourceLine({ source, detail }: { source: string; detail?: string }) {
  return (
    <div className="ticket-linked-issue-source flex flex-wrap items-center gap-1.5">
      <Text size="sm" variant="muted">
        {ticketLinkText.from}
      </Text>
      <Badge variant="secondary" size="sm">
        {source}
      </Badge>
      {detail && (
        <Text size="sm" variant="muted">
          {detail}
        </Text>
      )}
    </div>
  );
}

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
  // Redmine stored a new issue differently from what was sent; shown once saved.
  const [savedWarning, setSavedWarning] = useState<string | null>(null);

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
      .then(({ issue, baseUrl }) => {
        if (cancelled) return;
        const url = baseUrl ? `${baseUrl}/issues/${issue.id}` : null;
        setIssueState({ kind: 'loaded', issue, url });
      })
      .catch((err) => {
        if (cancelled) return;
        const notConnected = err instanceof ApiError && err.code === 'not-connected';
        setIssueState({ kind: notConnected ? 'not-connected' : 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [linkedId]);

  // A GitHub issue's title is read from GitHub when the section is shown, like
  // a Redmine issue's: only the link is stored. Private repositories answer
  // nothing here, and the link then shows as `owner/repo#12`.
  const githubParts = parseGithubIssueUrl(ticket.github);
  const [githubTitle, setGithubTitle] = useState<string | null>(null);
  useEffect(() => {
    setGithubTitle(null);
    if (!isGithubIssueUrl(ticket.github)) return;
    let cancelled = false;
    void fetchGithubIssueTitle(ticket.github).then((title) => !cancelled && setGithubTitle(title));
    return () => {
      cancelled = true;
    };
  }, [ticket.github]);

  const open = (next: Mode) => {
    setError(null);
    setSavedWarning(null);
    setForm(linkFormFor(ticket));
    setMode(next);
  };

  const run = async (target: LinkFormState) => {
    setSaving(true);
    setError(null);
    setSavedWarning(null);
    try {
      const updated = await applyTicketLink(ticket, target, { onWarning: setSavedWarning });
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
        <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
          {ticketLinkText.sectionTitle}
        </Text>

        {mode !== 'edit' && currentKind === 'none' && (
          <Text size="sm" variant="muted">
            {ticketLinkText.notLinked}
          </Text>
        )}

        {mode !== 'edit' && currentKind === 'github' && (
          <div className="ticket-linked-github space-y-1.5">
            <a
              href={ticket.github}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={ticketLinkText.openGithub(ticket.github)}
              className={LINK_CLASS}
            >
              {githubTitle && githubParts ? (
                <>
                  <span className="ticket-linked-issue-ref font-mono">#{githubParts.number}</span>
                  <span className="ticket-linked-issue-title">{githubTitle}</span>
                </>
              ) : (
                <span className="ticket-linked-issue-title break-all">
                  {githubLabel(ticket.github)}
                </span>
              )}
              <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            </a>
            <SourceLine
              source={ticketLinkText.github}
              detail={githubParts ? `${githubParts.owner}/${githubParts.repo}` : undefined}
            />
          </div>
        )}

        {mode !== 'edit' && linked && (
          <div className="ticket-linked-redmine space-y-1.5" aria-live="polite">
            {issueState.kind === 'loaded' && issueState.url ? (
              <a
                href={issueState.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={ticketLinkText.openIssue(ref)}
                className={LINK_CLASS}
              >
                <span className="ticket-linked-issue-ref font-mono">{ref}</span>
                <span className="ticket-linked-issue-title">{issueState.issue.subject}</span>
                <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <Text size="sm" className="font-mono font-medium">
                {ref}
                {issueState.kind === 'loaded' && ` ${issueState.issue.subject}`}
              </Text>
            )}
            <SourceLine
              source={ticketLinkText.redmine}
              detail={
                issueState.kind === 'loaded'
                  ? ticketLinkText.statusAndAssignee(
                      issueState.issue.status?.name ?? null,
                      issueState.issue.assignedTo?.name ?? null,
                    )
                  : undefined
              }
            />

            {issueState.kind === 'loading' && (
              <Spinner size="sm" label={ticketLinkText.loadingIssue} />
            )}
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
            allowNone={false}
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
          {savedWarning && (
            <Alert variant="warning">
              <AlertDescription>{savedWarning}</AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="danger" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {mode === 'view' && (
          <ButtonGroup className="ticket-linked-issue-actions">
            <Button variant="outline" size="sm" disabled={locked} onClick={() => open('edit')}>
              {currentKind === 'none' ? ticketLinkText.add : ticketLinkText.change}
            </Button>
            {currentKind !== 'none' && (
              <Button variant="ghost" size="sm" disabled={locked} onClick={() => open('remove')}>
                {ticketLinkText.remove}
              </Button>
            )}
          </ButtonGroup>
        )}

        {mode !== 'view' && (
          <ButtonGroup className="ticket-linked-issue-confirm">
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
          </ButtonGroup>
        )}
      </CardContent>
    </Card>
  );
}
