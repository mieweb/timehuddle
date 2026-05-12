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
  faGear,
  faInfo,
  faPalette,
  faRotateLeft,
  faRightFromBracket,
  faUser,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
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
  Switch,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { Capacitor } from '@capacitor/core';
import {
  checkPushNotificationStatus,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/nativePush';
import { authApi, userApi, notificationApi, teamApi } from '../lib/api';
import { GitHubConnectionRow } from './GitHubConnectionRow';
import { PulseSetup } from '../features/media/PulseSetup';
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

// ─── Dark mode row ─────────────────────────────────────────────────────────────

const DarkModeRow: React.FC = () => {
  const { theme, toggle } = useTheme();
  return (
    <Row label="Dark mode" hint="Use a dark colour scheme across the app">
      <Switch checked={theme === 'dark'} onCheckedChange={toggle} aria-label="Toggle dark mode" />
    </Row>
  );
};

// ─── Brand selector ────────────────────────────────────────────────────────────────────

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

  const handleTestPush = async () => {
    setLoading(true);
    try {
      await notificationApi.testPush();
      const successMsg = isNative
        ? 'Test push sent! You should receive a notification on this device.'
        : 'Test push sent! You should see a browser notification within a few seconds.';
      window.alert(successMsg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`Failed to send test push: ${msg}`);
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
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestPush}
              disabled={loading}
              isLoading={loading}
            >
              Send test push
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisable}
              disabled={loading}
              isLoading={loading}
            >
              Disable notifications
            </Button>
          </div>
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

// ─── Profile editor ───────────────────────────────────────────────────────────

const ProfileEditor: React.FC = () => {
  const { user, refetch } = useSession();
  const [name, setName] = useState(user?.name ?? '');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [reportsToUserId, setReportsToUserId] = useState('');
  const [reportsToOptions, setReportsToOptions] = useState<Array<{ value: string; label: string }>>(
    [{ value: '', label: 'No manager or lead set' }],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Load current profile values
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    void userApi.getUser(user.id).then((p) => {
      if (cancelled) return;
      setName(p.name ?? '');
      setBio(p.bio ?? '');
      setWebsite(p.website ?? '');
      setReportsToUserId(p.reportsTo?.id ?? '');
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    void (async () => {
      try {
        const teams = await teamApi.getTeams();
        const nonPersonalTeams = teams.filter((team) => !team.isPersonal);

        if (nonPersonalTeams.length === 0) {
          if (!cancelled) {
            setReportsToOptions([{ value: '', label: 'No manager or lead set' }]);
          }
          return;
        }

        const memberLists = await Promise.all(
          nonPersonalTeams.map((team) => teamApi.getMembers(team.id)),
        );
        const teammateOptions = new Map<string, { value: string; label: string }>();

        memberLists.flat().forEach((member) => {
          if (member.id === user.id) return;
          teammateOptions.set(member.id, {
            value: member.id,
            label: member.name || member.email || member.username || member.id,
          });
        });

        if (cancelled) return;

        setReportsToOptions([
          { value: '', label: 'No manager or lead set' },
          ...Array.from(teammateOptions.values()).sort((left, right) =>
            left.label.localeCompare(right.label),
          ),
        ]);
      } catch {
        if (!cancelled) {
          setReportsToOptions([{ value: '', label: 'No manager or lead set' }]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleSave = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await userApi.updateProfile({
        name,
        bio,
        website,
        reportsToUserId: reportsToUserId || null,
      });
      await refetch();
      setMessage({ ok: true, text: 'Profile saved.' });
    } catch (err: unknown) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed.' });
    } finally {
      setBusy(false);
    }
  };

  const websiteError =
    website && !/^https?:\/\/.+/.test(website) ? 'Must start with http:// or https://' : undefined;

  return (
    <div className="space-y-3 px-5 py-4">
      <div>
        <Text size="xs" weight="medium" className="mb-1 block">
          Display name
        </Text>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          size="sm"
          maxLength={PROFILE_DISPLAY_NAME_MAX}
          placeholder="Your display name"
          aria-label="Display name"
        />
        <Text variant="muted" size="xs" className="mt-1 text-right">
          {name.length}/{PROFILE_DISPLAY_NAME_MAX}
        </Text>
      </div>
      <div>
        <Text size="xs" weight="medium" className="mb-1 block">
          Email
        </Text>
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
          <Text size="sm" variant="muted">
            {user?.email}
          </Text>
        </div>
        <Text variant="muted" size="xs" className="mt-1">
          Email cannot be changed here.
        </Text>
      </div>
      {user?.username && (
        <div>
          <Text size="xs" weight="medium" className="mb-1 block">
            Username
          </Text>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
            <Text size="sm" variant="muted">
              @{user.username}
            </Text>
          </div>
          <Text variant="muted" size="xs" className="mt-1">
            Username cannot be changed after it is set.
          </Text>
        </div>
      )}
      <div>
        <Text size="xs" weight="medium" className="mb-1 block">
          Bio
        </Text>
        <Textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={PROFILE_BIO_MAX}
          placeholder="Tell your team a little about yourself"
          rows={3}
          aria-label="Bio"
        />
        <Text variant="muted" size="xs" className="mt-1 text-right">
          {bio.length}/{PROFILE_BIO_MAX}
        </Text>
      </div>
      <div>
        <Text size="xs" weight="medium" className="mb-1 block">
          Website
        </Text>
        <Input
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          size="sm"
          maxLength={PROFILE_WEBSITE_MAX}
          placeholder="https://example.com"
          type="url"
          aria-label="Website"
          error={websiteError}
        />
      </div>
      <div>
        <Text size="xs" weight="medium" className="mb-1 block">
          Reports To
        </Text>
        <Select
          label="Reports To"
          hideLabel
          size="sm"
          value={reportsToUserId}
          options={reportsToOptions}
          onValueChange={setReportsToUserId}
          aria-label="Select who you report to"
        />
        <Text variant="muted" size="xs" className="mt-1">
          Choose the teammate who manages or leads your work.
        </Text>
      </div>
      {message && (
        <Text size="xs" variant={message.ok ? 'success' : 'destructive'}>
          {message.text}
        </Text>
      )}
      <Button
        variant="primary"
        size="sm"
        onClick={() => void handleSave()}
        disabled={busy || !!websiteError}
        isLoading={busy}
        loadingText="Saving…"
      >
        Save profile
      </Button>
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
      {/* Profile */}
      <Section
        icon={faUser}
        title="Profile"
        description="Your display name, bio, website, and reporting line."
      >
        <ProfileEditor />
      </Section>

      {/* Appearance */}
      <Section
        icon={faPalette}
        title="Appearance"
        description="Control how the application looks on this device."
      >
        <DarkModeRow />
        <Row label="Brand theme" hint="Switch between brand themes">
          <BrandSelector />
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
        <GitHubConnectionRow />
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

      {/* Pulse Cam */}
      <Section
        icon={faVideo}
        title="Pulse Cam"
        description="Connect the Pulse Cam app to upload videos directly to tickets."
      >
        <PulseSetup />
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
