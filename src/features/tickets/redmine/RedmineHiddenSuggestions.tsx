/**
 * "Hidden suggestions" in the Redmine settings card.
 *
 * Lists the issues the user hid from their search suggestions, each with
 * Restore. Hiding only ever affected the suggestion dropdown, so restoring
 * only brings a suggestion back: the Tickets table never lost the row.
 */
import { Button, Skeleton, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { redmineApi, type RedmineIssue } from '../../../lib/api';
import { OverflowTooltip } from '../../../ui/OverflowTooltip';

import { suggestionText as text } from './suggestionStrings';
import { invalidateSuggestionsCache } from './useRedmineSuggestions';

export const RedmineHiddenSuggestions: React.FC = () => {
  const [issues, setIssues] = useState<RedmineIssue[] | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await redmineApi.prefs.listDismissed();
      setIssues(result.connected ? result.issues : []);
    } catch {
      setError(text.hiddenLoadFailed);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (issue: RedmineIssue) => {
    setRestoringId(issue.id);
    setError(null);
    try {
      await redmineApi.prefs.set(issue.id, null);
      setIssues((prev) => prev?.filter((row) => row.id !== issue.id) ?? null);
      // The dropdown caches its suggestions for the session; the restored issue
      // belongs back in them.
      invalidateSuggestionsCache();
    } catch {
      setError(text.restoreFailed(issue.id));
    } finally {
      setRestoringId(null);
    }
  };

  const loading = issues === null && !error;

  return (
    <section
      className="redmine-hidden-suggestions flex flex-col gap-2 border-t border-border pt-3"
      aria-labelledby="redmine-hidden-suggestions-heading"
      aria-busy={loading}
    >
      <Text as="h3" id="redmine-hidden-suggestions-heading" size="sm" weight="medium">
        {text.hiddenHeading}
      </Text>
      {loading ? (
        <div className="redmine-hidden-loading flex flex-col gap-3 py-1" aria-hidden="true">
          <Skeleton variant="text" width="85%" />
          {[0, 1].map((i) => (
            <div key={i} className="redmine-hidden-skeleton-row flex items-center gap-3">
              <Skeleton variant="text" width={36} className="shrink-0" />
              <Skeleton variant="text" className="flex-1" />
              <Skeleton width={72} height={28} className="shrink-0" />
            </div>
          ))}
        </div>
      ) : (
        // A failed load has no list to describe: the error below says so.
        issues !== null && (
          <Text variant="muted" size="xs">
            {issues.length ? text.hiddenExplainer : text.hiddenNone}
          </Text>
        )
      )}

      {!!issues?.length && (
        <ul className="redmine-hidden-list flex flex-col divide-y divide-border">
          {issues.map((issue) => (
            <li key={issue.id} className="redmine-hidden-row flex items-center gap-3 py-2">
              <Text as="span" size="xs" variant="muted" className="w-12 shrink-0 tabular-nums">
                #{issue.id}
              </Text>
              <OverflowTooltip content={issue.subject} className="flex-1">
                <Text as="span" size="sm" className="block min-w-0 truncate">
                  {issue.subject}
                </Text>
              </OverflowTooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void restore(issue)}
                isLoading={restoringId === issue.id}
                disabled={restoringId !== null}
                aria-label={text.restoreLabel(issue.id)}
              >
                {text.restore}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite" className="empty:hidden">
        {error && (
          <Text size="xs" variant="destructive" role="alert">
            {error}
          </Text>
        )}
      </div>
    </section>
  );
};
