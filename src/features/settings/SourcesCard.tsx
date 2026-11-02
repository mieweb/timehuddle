/**
 * Settings → Sources: one list of every ticket server a member can connect
 * (#734). The deployment's own Redmine comes first, then each server their orgs
 * registered, all the same row: enter your own key to connect, then check it or
 * disconnect. A key goes to the server once and never comes back.
 */
import { Badge, Button, ButtonGroup, Card, CardContent, Input, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  redmineApi,
  sourcesApi,
  type GitHubSourceConnection,
  type RedmineStatus,
  type SourceConnection,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { notifyRedmineChanged } from '../../lib/useRedmineStatus';
import { useQueryParams } from '../../ui/router';
import { RedmineHiddenSuggestions } from '../tickets/redmine/RedmineHiddenSuggestions';
import { invalidateSuggestionsCache } from '../tickets/redmine/useRedmineSuggestions';

import { SOURCES_STRINGS as text } from './settingsCopy';

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

function hostOfUrl(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

interface ServerRowProps {
  host: string;
  prefix?: string;
  login?: string | null;
  connected: boolean;
  rejected: boolean;
  /** Connects with a typed key. Without it, `oneClick` connects instead. */
  onConnect?: (apiKey: string) => Promise<void>;
  oneClick?: { label: string; start: () => Promise<void> };
  onCheck: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  /** After any action: a failed one may still have changed this server's state. */
  onSettled: (failed: boolean) => Promise<void>;
  /** Extra controls shown while not connected. */
  connectExtra?: React.ReactNode;
  children?: React.ReactNode;
}

const ServerRow: React.FC<ServerRowProps> = ({
  host,
  prefix,
  login,
  connected,
  rejected,
  onConnect,
  oneClick,
  onCheck,
  onDisconnect,
  onSettled,
  connectExtra,
  children,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<string | null>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    let failed = false;
    try {
      setNotice(await action());
    } catch (err: unknown) {
      failed = true;
      setError(messageOf(err, fallback));
    }
    await onSettled(failed).catch(() => undefined);
    setBusy(false);
  };

  const connect = () =>
    run(async () => {
      await onConnect?.(apiKey.trim());
      setApiKey('');
      return null;
    }, text.connectFailed);

  const detail = [prefix, connected && login ? `@${login}` : null].filter(Boolean).join(' · ');

  return (
    <div className="sources-server flex flex-col gap-3 px-5 py-4">
      <div className="sources-server-header flex flex-wrap items-center justify-between gap-3">
        <div className="sources-server-name flex min-w-0 items-center gap-3">
          {rejected ? (
            <Badge variant="danger">{text.rejected}</Badge>
          ) : connected ? (
            <Badge variant="success">{text.connected}</Badge>
          ) : (
            <Badge variant="secondary">{text.notConnected}</Badge>
          )}
          <div className="min-w-0">
            <Text size="sm" weight="medium" className="truncate">
              {host}
            </Text>
            {detail && (
              <Text variant="muted" size="xs" className="truncate">
                {detail}
              </Text>
            )}
          </div>
        </div>
        {connected && (
          <ButtonGroup>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={text.checkLabel(host)}
              onClick={() =>
                void run(async () => {
                  await onCheck();
                  return text.keyWorks;
                }, text.checkFailed)
              }
            >
              {text.check}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={text.disconnectLabel(host)}
              onClick={() =>
                void run(async () => {
                  await onDisconnect();
                  return null;
                }, text.disconnectFailed)
              }
            >
              {text.disconnect}
            </Button>
          </ButtonGroup>
        )}
      </div>

      {rejected && (
        <Text size="xs" role="alert">
          {text.rejectedHelp}
        </Text>
      )}

      {!connected && oneClick && (
        <ButtonGroup>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await oneClick.start();
                return null;
              }, text.connectFailed)
            }
          >
            {oneClick.label}
          </Button>
        </ButtonGroup>
      )}

      {!connected && onConnect && (
        <>
          <div className="sources-server-connect flex gap-2">
            <Input
              type="password"
              placeholder={text.keyPlaceholder}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              onKeyDown={(event) => {
                // Key-repeat must not launch a second validate while one is running.
                if (event.key === 'Enter' && !busy && apiKey.trim()) void connect();
              }}
              disabled={busy}
              className="h-8 flex-1 text-sm"
              size="sm"
              aria-label={text.keyLabel(host)}
            />
            <Button
              size="sm"
              className="h-8"
              disabled={!apiKey.trim() || busy}
              isLoading={busy}
              loadingText={text.connecting}
              aria-label={text.connectLabel(host)}
              onClick={() => void connect()}
            >
              {text.connect}
            </Button>
          </div>
          {connectExtra}
        </>
      )}

      {children}

      <div className="sources-server-messages" aria-live="polite">
        {notice && (
          <Text size="xs" variant="muted">
            {notice}
          </Text>
        )}
        {error && (
          <Text size="xs" variant="destructive" role="alert">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
};

export const SourcesCard: React.FC = () => {
  const [status, setStatus] = useState<RedmineStatus | null>(null);
  const [servers, setServers] = useState<SourceConnection[]>([]);
  const [github, setGithub] = useState<GitHubSourceConnection | null>(null);
  const [githubNotice, setGithubNotice] = useState<{ error: boolean; text: string } | null>(null);
  const { params, setParams } = useQueryParams();
  const connectCode = params.get('github_connect');
  const connectFailed = params.get('github_failed');
  const [baseUrl, setBaseUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Issue ids mean nothing across Redmine instances, so the URL can only change
  // between shifts. The server enforces this too; locking the field says so up front.
  const isClockedIn = Boolean(useTeam().activeClockEvent);

  const load = useCallback(async () => {
    const [nextStatus, list] = await Promise.allSettled([redmineApi.status(), sourcesApi.list()]);
    if (nextStatus.status === 'fulfilled') {
      setStatus(nextStatus.value);
      setBaseUrl(nextStatus.value.defaultBaseUrl ?? '');
    }
    if (list.status === 'fulfilled') {
      setServers(list.value.servers);
      setGithub(list.value.github);
    }
    const failed = [nextStatus, list].find((result) => result.status === 'rejected');
    setError(failed?.status === 'rejected' ? messageOf(failed.reason, text.loadFailed) : null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from GitHub: finish the connection as whoever is signed in here.
  useEffect(() => {
    if (!connectCode && !connectFailed) return;
    setParams({ github_connect: null, github_failed: null });
    if (connectFailed) {
      setGithubNotice({ error: true, text: text.githubFailed });
      return;
    }
    void sourcesApi
      .confirmGithub(connectCode!)
      .then(() => setGithubNotice({ error: false, text: text.githubConnected }))
      .catch((err: unknown) =>
        setGithubNotice({ error: true, text: messageOf(err, text.githubFailed) }),
      )
      .finally(() => void load());
  }, [connectCode, connectFailed, setParams, load]);

  if (!loaded) {
    return (
      <Card padding="none" className="sources-card">
        <CardContent className="px-5 py-4">
          <Text variant="muted" size="xs">
            {text.loading}
          </Text>
        </CardContent>
      </Card>
    );
  }

  const showUrlField = Boolean(status?.customUrlAllowed);
  const mainAddress = status?.baseUrl ?? status?.defaultBaseUrl ?? null;
  const hasMain = Boolean(status?.connected || status?.rejected || mainAddress || showUrlField);
  const mainServer = servers.find((server) => server.main);
  const otherServers = servers.filter((server) => !server.main);

  const afterMainChange = (next: RedmineStatus) => {
    setStatus(next);
    // The search bar caches its suggestions for the session, and the tickets
    // page stays mounted behind this route: tell both the link changed (#562).
    invalidateSuggestionsCache();
    notifyRedmineChanged(next);
  };

  return (
    <div className="sources-cards flex flex-col gap-4">
      {github && (
        <Card padding="none" className="sources-github-card">
          <CardContent className="p-0">
            {github &&
              (github.configured || github.connected ? (
                <ServerRow
                  host={github.host}
                  login={github.login}
                  connected={github.connected}
                  rejected={github.rejected}
                  oneClick={{
                    label: text.connectGithub,
                    start: async () => {
                      window.location.assign(await sourcesApi.githubConnectUrl());
                    },
                  }}
                  onCheck={async () => {
                    await sourcesApi.check(`https://${github.host}`);
                  }}
                  onDisconnect={async () => {
                    await sourcesApi.disconnect(`https://${github.host}`);
                  }}
                  onSettled={() => load()}
                >
                  {!github.connected && (
                    <Text variant="muted" size="xs">
                      {text.githubAccess}
                    </Text>
                  )}
                  {github.connected && (
                    <Text variant="muted" size="xs">
                      {text.githubOrgs}
                    </Text>
                  )}
                  {githubNotice && (
                    <Text
                      size="xs"
                      variant={githubNotice.error ? 'destructive' : 'muted'}
                      role={githubNotice.error ? 'alert' : 'status'}
                    >
                      {githubNotice.text}
                    </Text>
                  )}
                </ServerRow>
              ) : (
                <div className="sources-github-unavailable px-5 py-4">
                  <Text variant="muted" size="xs" role="status">
                    {text.githubNotSetUp}
                  </Text>
                </div>
              ))}
          </CardContent>
        </Card>
      )}
      <Card padding="none" className="sources-card">
        <CardContent className="divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
          <div className="sources-intro px-5 py-4">
            <Text variant="muted" size="xs">
              {text.description}
            </Text>
          </div>

          {hasMain && (
            <ServerRow
              host={hostOfUrl(mainAddress) ?? text.mainServerName}
              prefix={mainServer?.prefix}
              login={status?.redmineLogin}
              connected={Boolean(status?.connected)}
              rejected={Boolean(status?.rejected)}
              onConnect={async (apiKey) => {
                // Locked while clocked in: send nothing, so the server keeps its default.
                const url = showUrlField && !isClockedIn ? baseUrl.trim() : undefined;
                afterMainChange(await redmineApi.connect(apiKey, url));
              }}
              onCheck={async () => {
                await sourcesApi.check(mainAddress ?? '');
              }}
              onDisconnect={async () => afterMainChange(await redmineApi.disconnect())}
              // A success already set the status it answered with.
              onSettled={async (failed) => {
                if (failed) await load();
              }}
              connectExtra={
                showUrlField && (
                  <Input
                    type="url"
                    label={text.urlLabel}
                    placeholder={text.urlPlaceholder}
                    value={isClockedIn ? (status?.defaultBaseUrl ?? '') : baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    disabled={isClockedIn}
                    helperText={isClockedIn ? text.urlLocked : text.urlHelp}
                    className="redmine-base-url h-8 text-sm"
                    size="sm"
                  />
                )
              }
            >
              {status?.connected && <RedmineHiddenSuggestions />}
            </ServerRow>
          )}

          {otherServers.map((server) => (
            <ServerRow
              key={server.host}
              host={server.host}
              prefix={server.prefix}
              login={server.login}
              connected={server.connected}
              rejected={server.rejected}
              onConnect={async (apiKey) => {
                await sourcesApi.connect(server.baseUrl, apiKey);
              }}
              onCheck={async () => {
                await sourcesApi.check(server.baseUrl);
              }}
              onDisconnect={async () => {
                await sourcesApi.disconnect(server.baseUrl);
              }}
              onSettled={() => load()}
            />
          ))}

          {!hasMain && otherServers.length === 0 && !error && (
            <div className="sources-empty px-5 py-4">
              <Text variant="muted" size="xs" role="status">
                {text.empty}
              </Text>
            </div>
          )}

          {error && (
            <div className="sources-error px-5 py-4">
              <Text size="xs" variant="destructive" role="alert">
                {error}
              </Text>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
