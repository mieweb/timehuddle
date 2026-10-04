/**
 * The "Linked issue" card on a TimeHuddle ticket's page.
 *
 * The ticket stores only the linked issue's number. Everything shown here is
 * read from Redmine with the viewer's own key, so a teammate who has not
 * connected Redmine, or cannot see the issue, is told why instead of seeing
 * someone else's view of it.
 */
import { Badge, Button, Card, CardContent, Spinner, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, redmineApi, type RedmineIssue, type Ticket } from '../../../lib/api';
import { useRouter } from '../../../ui/router';
import { ticketDetailPath } from '../sources';

import { TicketConnectDialog } from './TicketConnectDialog';
import { TicketLinkConfirmDialog } from './TicketLinkConfirmDialog';
import { ticketLinkText } from './ticketLinkStrings';

export interface LinkedIssueCardProps {
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

export function LinkedIssueCard({ ticket, onChanged, locked = false }: LinkedIssueCardProps) {
  const { navigate } = useRouter();
  const [state, setState] = useState<IssueState>({ kind: 'loading' });
  const [connectOpen, setConnectOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const linked = ticket.linkedIssue;
  const linkedId = linked?.id ?? null;

  useEffect(() => {
    if (!linkedId) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    redmineApi.issues
      .get(Number(linkedId))
      .then(({ issue }) => !cancelled && setState({ kind: 'loaded', issue }))
      .catch((err) => {
        if (cancelled) return;
        const notConnected = err instanceof ApiError && err.code === 'not-connected';
        setState({ kind: notConnected ? 'not-connected' : 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [linkedId]);

  const ref = linked ? `#${linked.id}` : '';

  return (
    <Card>
      <CardContent className="ticket-linked-issue space-y-3">
        <Text size="sm" className="font-semibold text-neutral-700 dark:text-neutral-300">
          {ticketLinkText.cardTitle}
        </Text>

        {!linked ? (
          <Text size="sm" variant="muted">
            {ticketLinkText.notLinked}
          </Text>
        ) : (
          <div className="ticket-linked-issue-body space-y-2" aria-live="polite">
            <div className="ticket-linked-issue-meta flex flex-wrap items-center gap-2">
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
              {state.kind === 'loaded' && state.issue.status && (
                <Badge size="sm" variant={state.issue.status.isClosed ? 'secondary' : 'success'}>
                  {state.issue.status.name}
                </Badge>
              )}
            </div>

            {state.kind === 'loading' && <Spinner size="sm" label={ticketLinkText.loadingIssue} />}
            {state.kind === 'loaded' && (
              <>
                <Text size="sm">{state.issue.subject}</Text>
                <Text size="sm" variant="muted">
                  {state.issue.assignedTo
                    ? ticketLinkText.assignedTo(state.issue.assignedTo.name)
                    : ticketLinkText.unassigned}
                </Text>
              </>
            )}
            {state.kind === 'not-connected' && (
              <>
                <Text size="sm" variant="muted">
                  {ticketLinkText.notConnected}
                </Text>
                <Button variant="outline" size="sm" onClick={() => navigate('/app/settings')}>
                  {ticketLinkText.goToSettings}
                </Button>
              </>
            )}
            {state.kind === 'unavailable' && (
              <Text size="sm" variant="muted">
                {ticketLinkText.issueUnavailable}
              </Text>
            )}
          </div>
        )}

        <div className="ticket-linked-issue-actions flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => setConnectOpen(true)}
          >
            {linked ? ticketLinkText.change : ticketLinkText.connect}
          </Button>
          {linked && (
            <Button variant="ghost" size="sm" disabled={locked} onClick={() => setUnlinkOpen(true)}>
              {ticketLinkText.unlink}
            </Button>
          )}
        </div>
      </CardContent>

      <TicketConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        ticket={ticket}
        onChanged={onChanged}
      />
      <TicketLinkConfirmDialog
        open={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        ticket={ticket}
        onChanged={onChanged}
      />
    </Card>
  );
}
