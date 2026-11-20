/**
 * Settings → Sources → GitHub (#873): a member connects their own GitHub account
 * in one click, picks which accounts' issues to bring in, or disconnects.
 *
 * Connecting leaves for GitHub's approval page and comes back with
 * `?github_connect=<code>`, which is confirmed here as whoever is signed in, so
 * nobody else's GitHub can land on this account. The token never reaches the
 * browser.
 */
import { Badge, Button, ButtonGroup, Card, CardContent, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { sourcesApi, type GitHubSourceConnection } from '../../lib/api';
import { useQueryParams } from '../../ui/router';

import { GitHubOwnersPicker } from './GitHubOwnersPicker';
import { GITHUB_SOURCE_STRINGS as text } from './settingsCopy';

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

type Notice = { error: boolean; text: string };

function StatusBadge({ github }: { github: GitHubSourceConnection }) {
  if (github.rejected) return <Badge variant="danger">{text.rejected}</Badge>;
  if (github.connected) return <Badge variant="success">{text.connected}</Badge>;
  return <Badge variant="secondary">{text.notConnected}</Badge>;
}

export const GitHubSourceCard: React.FC = () => {
  const [github, setGithub] = useState<GitHubSourceConnection | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const { params, setParams } = useQueryParams();
  const connectCode = params.get('github_connect');
  const connectFailed = params.get('github_failed');

  const load = useCallback(async () => {
    try {
      setGithub(await sourcesApi.github());
    } catch (err) {
      setNotice({ error: true, text: messageOf(err, text.loadFailed) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from GitHub: finish the connection as whoever is signed in here.
  useEffect(() => {
    if (!connectCode && !connectFailed) return;
    setParams({ github_connect: null, github_failed: null });
    if (connectFailed) {
      setNotice({ error: true, text: text.failed });
      return;
    }
    void sourcesApi
      .confirmGithub(connectCode!)
      .then((next) => {
        setGithub(next);
        setNotice({ error: false, text: text.justConnected });
      })
      .catch((err: unknown) => setNotice({ error: true, text: messageOf(err, text.failed) }));
  }, [connectCode, connectFailed, setParams]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ error: true, text: messageOf(err, fallback) });
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      window.location.assign(await sourcesApi.githubConnectUrl());
    }, text.connectFailed);

  const disconnect = () =>
    run(async () => {
      setGithub(await sourcesApi.disconnectGithub());
    }, text.disconnectFailed);

  return (
    <Card padding="none" className="github-source-card">
      <CardContent className="github-source flex flex-col gap-3 px-5 py-4">
        {!github ? (
          <Text variant="muted" size="xs" role="status">
            {notice?.text ?? text.loading}
          </Text>
        ) : !github.configured && !github.connected ? (
          <Text variant="muted" size="xs" role="status">
            {text.notSetUp}
          </Text>
        ) : (
          <>
            <div className="github-source-header flex flex-wrap items-center justify-between gap-3">
              <div className="github-source-name flex min-w-0 items-center gap-3">
                <StatusBadge github={github} />
                <div className="min-w-0">
                  <Text size="sm" weight="medium">
                    {text.title}
                  </Text>
                  {github.connected && github.login && (
                    <Text variant="muted" size="xs" className="truncate">
                      {text.connectedAs(github.login)}
                    </Text>
                  )}
                </div>
              </div>
              <ButtonGroup>
                {github.connected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={text.disconnectLabel}
                    onClick={() => void disconnect()}
                  >
                    {text.disconnect}
                  </Button>
                ) : (
                  <Button size="sm" disabled={busy} onClick={() => void connect()}>
                    {text.connect}
                  </Button>
                )}
              </ButtonGroup>
            </div>

            {github.rejected && (
              <Text size="xs" role="alert">
                {text.rejectedHelp}
              </Text>
            )}
            {!github.connected && (
              <Text variant="muted" size="xs">
                {text.access}
              </Text>
            )}
            {github.connected && (
              <>
                <GitHubOwnersPicker owners={github.owners} />
                <Text variant="muted" size="xs">
                  {text.orgs}
                </Text>
              </>
            )}
          </>
        )}

        <div className="github-source-messages" aria-live="polite">
          {github && notice && (
            <Text
              size="xs"
              variant={notice.error ? 'destructive' : 'muted'}
              role={notice.error ? 'alert' : 'status'}
            >
              {notice.text}
            </Text>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
