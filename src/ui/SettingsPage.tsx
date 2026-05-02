/**
 * SettingsPage — User & application settings.
 * Sections:
 *   • Profile       — display name, bio, website, linked sign-in accounts, password reset
 *   • Appearance    — theme toggle
 *   • Account       — sign out
 *   • About         — stack versions
 */
import {
  faBell,
  faCircleUser,
  faGear,
  faInfo,
  faMoon,
  faPalette,
  faRotateLeft,
  faRightFromBracket,
  faSun,
} from '@fortawesome/free-solid-svg-icons';
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { Capacitor } from '@capacitor/core';
import {
  checkPushNotificationStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/nativePush';
import { authApi, userApi, type AuthAccount } from '../lib/api';
import { PROFILE_BIO_MAX, PROFILE_DISPLAY_NAME_MAX, PROFILE_WEBSITE_MAX } from '../lib/constants';
import { useBrand, BRANDS } from '../lib/useBrand';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { AppPage } from './AppPage';

// ─── Primitives ───────────────────────────────────────────────────────────────

const Section: React.FC<{
  icon: typeof faGear;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ icon, title, description, children }) => (
  <Card padding="none">
    <CardHeader className="flex items-start gap-3 px-5 py-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        <FontAwesomeIcon icon={icon} className="text-sm" />
      </div>
      <div>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && (
          <Text variant="muted" size="xs" className="mt-0.5">
            {description}
          </Text>
        )}
      </div>
    </CardHeader>
    <CardContent className="divide-y divide-neutral-100 p-0 dark:divide-neutral-800">
      {children}
    </CardContent>
  </Card>
);

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
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

// ─── Profile settings ─────────────────────────────────────────────────────────

const ProfileSettings: React.FC = () => {
  const { user: sessionUser, refetch: refetchSession } = useSession();

  const [displayName, setDisplayName] = useState(sessionUser?.name ?? '');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [accounts, setAccounts] = useState<AuthAccount[]>([]);
  const [accountsReady, setAccountsReady] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  // Load full profile (bio, website) from the server
  useEffect(() => {
    if (!sessionUser?.id) return;
    userApi
      .getUser(sessionUser.id)
      .then((p) => {
        setDisplayName(p.name || '');
        setBio(p.bio || '');
        setWebsite(p.website || '');
        setProfileLoaded(true);
      })
      .catch(() => setProfileLoaded(true));
  }, [sessionUser?.id]);

  // Load linked sign-in accounts
  useEffect(() => {
    setAccountsReady(false);
    authApi
      .listAccounts()
      .then((list) => setAccounts(list))
      .catch((err) => {
        setAccounts([]);
        setAccountsError(err instanceof Error ? err.message : 'Unable to load sign-in methods');
      })
      .finally(() => setAccountsReady(true));
  }, []);

  const refreshAccounts = async () => {
    const list = await authApi.listAccounts();
    setAccounts(list);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await userApi.updateProfile({
        name: displayName.trim() || undefined,
        bio: bio.trim(),
        website: website.trim(),
      });
      await refetchSession();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const connectGitHub = async () => {
    if (githubBusy) return;
    setAuthMessage(null);
    setGithubBusy(true);
    try {
      const callbackURL = `${window.location.origin}/app/settings`;
      const url = await authApi.linkSocial('github', callbackURL);
      window.location.href = url;
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to connect GitHub');
      setGithubBusy(false);
    }
  };

  const disconnectGitHub = async () => {
    if (githubBusy) return;
    setAuthMessage(null);
    setGithubBusy(true);
    try {
      await authApi.unlinkAccount('github');
      await refreshAccounts();
      setAuthMessage('GitHub disconnected.');
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to disconnect GitHub');
    } finally {
      setGithubBusy(false);
    }
  };

  const sendPasswordSetupEmail = async () => {
    if (!sessionUser?.email || sendingReset) return;
    setAuthMessage(null);
    setSendingReset(true);
    try {
      await authApi.requestPasswordReset(sessionUser.email, `${window.location.origin}/app`);
      setAuthMessage('Password setup email sent. Check your inbox.');
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : 'Failed to send password setup email');
    } finally {
      setSendingReset(false);
    }
  };

  const hasGitHub = accounts.some((a) => a.providerId === 'github');
  const hasCredential = accounts.some((a) => a.providerId === 'credential');
  const canDisconnectGitHub = hasGitHub && accounts.length > 1;

  return (
    <>
      {/* Profile info form */}
      <div className="px-5 py-4">
        <form onSubmit={(e) => void saveProfile(e)} className="space-y-4">
          {sessionUser?.email && (
            <div>
              <Text size="xs" weight="medium" variant="muted" className="mb-1">
                Email
              </Text>
              <Text size="sm">{sessionUser.email}</Text>
            </div>
          )}

          {!profileLoaded ? (
            <Text variant="muted" size="sm">
              Loading profile…
            </Text>
          ) : (
            <>
              <Input
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={PROFILE_DISPLAY_NAME_MAX}
                placeholder="Your name"
              />

              <div className="space-y-1">
                <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={PROFILE_BIO_MAX}
                  rows={3}
                  placeholder="A short bio…"
                  className="w-full resize-none rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-neutral-700 dark:text-neutral-100"
                />
              </div>

              <Input
                label="Website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                maxLength={PROFILE_WEBSITE_MAX}
                placeholder="https://yoursite.com"
                type="url"
              />
            </>
          )}

          {saveError && (
            <Text variant="destructive" size="xs">
              {saveError}
            </Text>
          )}

          {saveSuccess && (
            <Text size="xs" className="text-green-600 dark:text-green-400">
              Profile saved.
            </Text>
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isLoading={saving}
              loadingText="Saving…"
              disabled={!profileLoaded}
            >
              Save profile
            </Button>
          </div>
        </form>
      </div>

      {/* Linked sign-in accounts */}
      <div className="border-t border-neutral-100 px-5 py-4 dark:border-neutral-800">
        <Text size="sm" weight="semibold" className="mb-3">
          Sign-in Methods
        </Text>

        {!accountsReady ? (
          <Text variant="muted" size="sm">
            Loading sign-in methods…
          </Text>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FontAwesomeIcon icon={faGithub} className="text-neutral-500" />
                <div>
                  <Text size="sm" weight="medium">
                    GitHub
                  </Text>
                  <Text variant="muted" size="xs">
                    {hasGitHub ? 'Connected' : 'Not connected'}
                  </Text>
                </div>
              </div>

              {hasGitHub ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void disconnectGitHub()}
                  isLoading={githubBusy}
                  loadingText="Disconnecting…"
                  disabled={!canDisconnectGitHub || githubBusy || sendingReset}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void connectGitHub()}
                  isLoading={githubBusy}
                  loadingText="Connecting…"
                  disabled={githubBusy || sendingReset}
                >
                  Connect
                </Button>
              )}
            </div>

            {hasGitHub && !canDisconnectGitHub && (
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900/40">
                <Text size="xs" variant="muted">
                  To disconnect GitHub, add another sign-in method first.
                </Text>
                {!hasCredential && (
                  <div className="mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void sendPasswordSetupEmail()}
                      isLoading={sendingReset}
                      loadingText="Sending…"
                      disabled={githubBusy || sendingReset}
                    >
                      Set Password via Email
                    </Button>
                  </div>
                )}
              </div>
            )}

            {accountsError && (
              <Text variant="destructive" size="xs">
                {accountsError}
              </Text>
            )}

            {authMessage && (
              <Text size="xs" variant="muted">
                {authMessage}
              </Text>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ─── Theme selector ───────────────────────────────────────────────────────────

const ThemeSelector: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const options: { value: 'light' | 'dark'; icon: typeof faSun; label: string }[] = [
    { value: 'light', icon: faSun, label: 'Light' },
    { value: 'dark', icon: faMoon, label: 'Dark' },
  ];

  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex gap-2">
      {options.map(({ value, icon, label }) => (
        <Button
          key={value}
          variant={theme === value ? 'primary' : 'outline'}
          size="sm"
          leftIcon={<FontAwesomeIcon icon={icon} className="text-xs" />}
          onClick={() => setTheme(value)}
          aria-checked={theme === value}
        >
          {label}
        </Button>
      ))}
    </div>
  );
};

// ─── Brand selector ──────────────────────────────────────────────────────────

const brandOptions = BRANDS.map((b) => ({
  value: b.id,
  label: `${b.emoji} ${b.label}`,
}));

const BrandSelector: React.FC = () => {
  const { brand, setBrand } = useBrand();

  return (
    <Select
      label="Brand theme"
      hideLabel
      size="sm"
      value={brand}
      options={brandOptions}
      onValueChange={(v) => setBrand(v as typeof brand)}
      aria-label="Switch between brand themes"
    />
  );
};

// ─── Push notifications (Web Push — timeharbor-old parity) ────────────────────

const PushNotificationsSettings: React.FC = () => {
  const isNative = Capacitor.isNativePlatform();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  // VAPID check is only relevant on the web; always pass on native.
  const [serverHasVapid, setServerHasVapid] = useState<boolean | null>(isNative ? true : null);

  const refreshStatus = useCallback(async () => {
    if (isNative) {
      // On native we don't have a synchronous way to check if we are subscribed
      // without a stored token, so treat "supported" as the indicator.
      return;
    }
    if (!isPushSupported()) {
      setEnabled(false);
      return;
    }
    const st = await checkPushNotificationStatus();
    setEnabled(st.permission === 'granted' && st.subscribed && st.serverEnabled);
  }, [isNative]);

  useEffect(() => {
    setSupported(isPushSupported());
    if (!isNative) {
      // VAPID key is configured if the env var is present
      const vapidKey =
        (typeof import.meta !== 'undefined' &&
          (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
        '';
      setServerHasVapid(vapidKey.length > 0);
    }
    void refreshStatus();
  }, [isNative, refreshStatus]);

  const handleEnable = async () => {
    setLoading(true);
    try {
      await subscribeToPush();
      if (!isNative) await refreshStatus();
      else setEnabled(true);

      window.alert(
        'Notifications enabled! You will receive alerts when team members clock in or out.',
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      let detail = 'Failed to enable notifications. ';
      if (msg.includes('permission') || msg.includes('denied')) {
        detail += 'Please allow notifications in your browser settings.';
      } else if (msg.includes('not-configured')) {
        detail += 'The server is missing VAPID keys in settings.';
      } else {
        detail += msg;
      }

      window.alert(detail);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Are you sure you want to disable push notifications?')) return;
    setLoading(true);
    try {
      await unsubscribeFromPush();
      if (!isNative) await refreshStatus();
      else setEnabled(false);

      window.alert('Notifications disabled.');
    } catch {
      window.alert('Failed to disable notifications. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 px-5 py-4">
      {serverHasVapid === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Web Push is not configured on this server. Add VAPID keys to{' '}
          <code className="text-xs">settings.json</code> (see{' '}
          <code className="text-xs">settings.push.example.json</code>).
        </div>
      )}
      {!supported ? (
        <Text variant="muted" size="sm">
          Push notifications are not supported on this platform.
        </Text>
      ) : enabled ? (
        <>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
            Notifications are enabled. You will receive alerts when team members clock in or out.
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisable}
            disabled={loading}
            isLoading={loading}
          >
            Disable notifications
          </Button>
        </>
      ) : (
        <>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Enable push notifications to get notified when your team members clock in or clock out.
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleEnable}
            disabled={loading || serverHasVapid === false}
            isLoading={loading}
            leftIcon={<FontAwesomeIcon icon={faBell} className="text-xs" />}
          >
            Enable notifications
          </Button>
        </>
      )}
    </div>
  );
};

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export const SettingsPage: React.FC = () => {
  const { user, signOut } = useSession();
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  const handlePasswordReset = async () => {
    if (!user?.email || resetBusy) return;
    setResetBusy(true);
    setResetMessage(null);
    try {
      await authApi.requestPasswordReset(user.email, `${window.location.origin}/app`);
      setResetMessage('Check your email for a password reset link.');
    } catch (error: unknown) {
      setResetMessage(error instanceof Error ? error.message : 'Failed to send reset email.');
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <AppPage>
      {/* Appearance */}
      <Section
        icon={faPalette}
        title="Appearance"
        description="Control how the application looks on this device."
      >
        <Row label="Brand theme" hint="Switch between brand themes">
          <BrandSelector />
        </Row>
        <Row label="Colour theme" hint="Persisted in localStorage for this browser">
          <ThemeSelector />
        </Row>
      </Section>

      {/* Push notifications */}
      <Section
        icon={faBell}
        title="Push notifications"
        description="Browser alerts for team clock in/out (same as Time Harbor)."
      >
        <PushNotificationsSettings />
      </Section>

      {/* Account */}
      <Section icon={faGear} title="Account">
        <Row label="Reset password" hint="We will email you a link to choose a new password">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<FontAwesomeIcon icon={faRotateLeft} className="text-xs" />}
            onClick={() => void handlePasswordReset()}
            disabled={!user?.email || resetBusy}
            isLoading={resetBusy}
            loadingText="Sending…"
          >
            Reset password
          </Button>
        </Row>
        {resetMessage && (
          <div className="px-5 py-3.5">
            <Text variant="muted" size="xs">
              {resetMessage}
            </Text>
          </div>
        )}
        <Row label="Sign out" hint="You will be returned to the login screen">
          <Button
            variant="danger"
            size="sm"
            leftIcon={<FontAwesomeIcon icon={faRightFromBracket} className="text-xs" />}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </Row>
      </Section>

      {/* About */}
      <Section icon={faInfo} title="About" description="Stack versions for this application.">
        {(
          [
            ['Vite', '8'],
            ['React', '19'],
            ['Tailwind CSS', '4'],
            ['TypeScript', '5.9'],
            ['Node.js', '22'],
          ] as const
        ).map(([name, version]) => (
          <Row key={name} label={name}>
            <Badge variant="outline">{version}</Badge>
          </Row>
        ))}
      </Section>
    </AppPage>
  );
};
