/**
 * "Bring issues from": the GitHub accounts and organizations a member's
 * assigned issues and search come from, on the GitHub row of Settings → Sources.
 * None picked means all of them. Saved as soon as it changes.
 */
import { Select, Text } from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { sourcesApi, type GitHubOwner } from '../../lib/api';
import { invalidateSuggestionsCache } from '../tickets/redmine/useRedmineSuggestions';

import { SOURCES_STRINGS as text } from './settingsCopy';

interface GitHubOwnersPickerProps {
  /** The accounts picked now; null for all of them. */
  owners: string[] | null;
}

export const GitHubOwnersPicker: React.FC<GitHubOwnersPickerProps> = ({ owners }) => {
  const [available, setAvailable] = useState<GitHubOwner[] | null>(null);
  const [picked, setPicked] = useState<string[]>(owners ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    sourcesApi
      .githubOwners()
      .then(({ owners: list }) => current && setAvailable(list))
      .catch(() => current && setError(text.githubOwnersFailed));
    return () => {
      current = false;
    };
  }, []);

  const save = async (next: string[]) => {
    const previous = picked;
    setPicked(next);
    setSaving(true);
    setError(null);
    try {
      await sourcesApi.setGithubOwners(next.length ? next : null);
      // The search bar's suggestions came from the previous choice.
      invalidateSuggestionsCache();
    } catch {
      setPicked(previous);
      setError(text.githubOwnersSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  // A picked account the member can no longer reach still shows, so it can be removed.
  const logins = [
    ...(available ?? []),
    ...picked
      .filter((login) => !available?.some((owner) => owner.login === login))
      .map((login) => ({ login, own: false })),
  ];

  return (
    <div className="sources-github-owners flex flex-col gap-1">
      <Select
        multiple
        size="sm"
        label={text.githubOwnersLabel}
        className="sources-github-owners-select max-w-md"
        placeholder={text.githubOwnersPlaceholder}
        options={logins.map(({ login, own }) => ({
          value: login,
          label: own ? text.githubOwnLabel(login) : login,
        }))}
        value={picked}
        onValueChange={(next) => void save(next)}
        disabled={saving || available === null}
      />
      <Text variant="muted" size="xs">
        {text.githubOwnersHelp}
      </Text>
      {error && (
        <Text size="xs" variant="destructive" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
};
