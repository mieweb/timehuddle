/**
 * `/app/tickets/redmine/:id` since #736: a Redmine issue has no page of its own.
 *
 * Old links still point here (search suggestions, timesheet rows for time
 * logged on a bare issue). The issue's ticket in the selected team is found, or
 * created and linked (`../carryIssue.ts`), and the URL is replaced with that
 * ticket's page, so Back skips this hop.
 */
import { Alert, Spinner } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { useTeam } from '../../../lib/TeamContext';
import { AppPage } from '../../../ui/AppPage';
import { useRouter } from '../../../ui/router';
import { carriedKey } from '../carryIssue';
import { ticketKey, ticketRefOf } from '../sources';
import { timerErrorMessage } from '../startTicketTimer';

import { BackToTicketsButton } from './BackToTicketsButton';

export const RedmineIssueRedirect: React.FC<{ issueId: number }> = ({ issueId }) => {
  const { selectedTeamId, teamsReady } = useTeam();
  const { replace } = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for the team list, so "no team" means none rather than not loaded yet.
    if (!teamsReady) return;
    let cancelled = false;
    carriedKey(ticketKey('redmine', String(issueId)), selectedTeamId).then(
      (key) => {
        if (!cancelled) replace(`/app/tickets/${ticketRefOf(key).ticketId}`);
      },
      (err: unknown) => {
        if (!cancelled) setError(timerErrorMessage(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [issueId, selectedTeamId, teamsReady, replace]);

  return (
    <AppPage>
      {error ? (
        <div className="redmine-issue-redirect-error flex flex-col gap-4 py-8">
          <BackToTicketsButton />
          <Alert variant="warning" role="alert">
            {error}
          </Alert>
        </div>
      ) : (
        <div
          className="redmine-issue-redirect-loading flex items-center justify-center py-24"
          aria-busy="true"
        >
          <Spinner />
        </div>
      )}
    </AppPage>
  );
};
