import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { authApi, type AuthAccount } from '../lib/api';

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
        <Text variant="muted" size="xs" className="mt-0.5">
          {hint}
        </Text>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

export const GitHubConnectionRow: React.FC = () => {
  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await authApi.listAccounts();
      setAccounts(list);
    } catch {
      // ignore — user may not have any linked accounts
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const githubAccount = accounts.find((a) => a.providerId === 'github');
  const hasPasswordLogin = accounts.some((a) => a.providerId === 'credential');
  const canDisconnect = hasPasswordLogin;

  const handleConnect = async () => {
    setBusy(true);
    try {
      const url = await authApi.linkSocial('github', `${window.location.origin}/app/settings`);
      window.location.href = url;
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to connect GitHub.');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!githubAccount) return;
    if (!window.confirm('Disconnect your GitHub account?')) return;
    setBusy(true);
    try {
      await authApi.unlinkAccount(githubAccount.providerId);
      await refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to disconnect GitHub.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row
      label="GitHub"
      hint={
        githubAccount
          ? canDisconnect
            ? 'Your GitHub account is connected'
            : 'Your GitHub account is connected — set a password before disconnecting'
          : 'Connect GitHub to sign in with your GitHub account'
      }
    >
      {githubAccount ? (
        <Button
          variant="outline"
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faGithub} className="text-xs" />}
          onClick={() => void handleDisconnect()}
          disabled={busy || !canDisconnect}
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
