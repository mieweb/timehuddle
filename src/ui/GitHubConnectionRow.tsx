import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { githubApi, type GitHubLinkStatus } from '../lib/api';
import { useQueryParams } from './router';

interface RowProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

const Row: React.FC<RowProps> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-4 px-5 py-3.5">
    <div className="min-w-0">
      <Text size="sm" weight="medium">
        {label}
      </Text>
      {hint && (
        <Text variant="muted" size="xs" className="mt-0.5" aria-live="polite">
          {hint}
        </Text>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/**
 * The outcome of Connect GitHub: what `/auth/github?link=` reports back in
 * `?github=` when it refuses, or what `github.confirmLink` returns.
 */
const LINK_RESULT_MESSAGES: Record<string, string> = {
  connected: 'GitHub connected. You can now sign in with GitHub.',
  taken: 'That GitHub account is already connected to another TimeHuddle user.',
  expired: 'The GitHub connection timed out. Please try again.',
};

/** Only the declared results — `?github=__proto__` must not reach the page. */
function linkMessage(result: string | null): string | undefined {
  return result && Object.hasOwn(LINK_RESULT_MESSAGES, result)
    ? LINK_RESULT_MESSAGES[result]
    : undefined;
}

export const GitHubConnectionRow: React.FC = () => {
  const [status, setStatus] = useState<GitHubLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const { params, setParams } = useQueryParams();
  const linkResult = params.get('github');
  // Set by the OAuth callback when GitHub came back fine: the link is staged
  // and this signed-in user has to confirm it (see github-link.js for why).
  const confirmCode = params.get('github_confirm');
  // Both are read once — the effect below removes them from the URL.
  const [message, setMessage] = useState(() => linkMessage(linkResult));
  const [codeToConfirm] = useState(confirmCode);
  const confirmStarted = useRef(false);

  useEffect(() => {
    // Shown once — a reload shouldn't repeat it.
    if (linkResult || confirmCode) setParams({ github: null, github_confirm: null });
  }, [linkResult, confirmCode, setParams]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await githubApi.status());
    } catch {
      // leave the row in its "not connected" state
    }
  }, []);

  useEffect(() => {
    if (!codeToConfirm) {
      void refresh();
      return;
    }
    // The code is single-use, and StrictMode runs effects twice.
    if (confirmStarted.current) return;
    confirmStarted.current = true;
    githubApi
      .confirmLink(codeToConfirm)
      .then(({ result, status: confirmed }) => {
        setStatus(confirmed);
        setMessage(linkMessage(result));
      })
      .catch(() => {
        setMessage(linkMessage('expired'));
        void refresh();
      });
  }, [codeToConfirm, refresh]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      window.location.href = await githubApi.linkUrl();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to connect GitHub.');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your GitHub account?')) return;
    setBusy(true);
    try {
      setStatus(await githubApi.disconnect());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to disconnect GitHub.');
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected ?? false;

  return (
    <Row
      label="GitHub"
      hint={
        message ??
        (connected
          ? `Connected as @${status?.username}`
          : 'Connect GitHub to sign in with your GitHub account')
      }
    >
      {connected ? (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faGithub} className="text-xs" />}
          onClick={() => void handleDisconnect()}
          disabled={busy}
          isLoading={busy}
        >
          Disconnect
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faGithub} className="text-xs" />}
          onClick={() => void handleConnect()}
          disabled={busy}
          isLoading={busy}
        >
          Connect GitHub
        </Button>
      )}
    </Row>
  );
};
