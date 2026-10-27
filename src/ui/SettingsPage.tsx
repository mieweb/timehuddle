/**
 * SettingsPage — User & application settings.
 *
 * `?section=` picks the section shown. On desktop a side nav sits beside it,
 * and no section means Profile. On a phone no section means the menu, a list
 * of every section, and an open section has a back button to it. The sections
 * and their copy are in features/settings/settingsSections.ts.
 */
import {
  Badge,
  BellIcon,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChevronLeftIcon,
  ChevronRightIcon,
  cn,
  Input,
  LogOutIcon,
  RefreshIcon,
  Select,
  Spinner,
  Switch,
  Text,
  Textarea,
  TrashIcon,
  useMediaQuery,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  checkPushNotificationStatus,
  isPushSupported,
  isNativePushRegistered,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/nativePush';
import { useRefresh } from '../lib/RefreshContext';
import {
  userApi,
  notificationApi,
  teamApi,
  tokenApi,
  redmineApi,
  type PersonalAccessToken,
  type RedmineStatus,
} from '../lib/api';
import { getDdpClient } from '../lib/ddp';
import {
  PERSONAL_SECTIONS,
  settingsGroups,
  SETTINGS_PAGE_STRINGS,
  resolveSettingsSection,
  type SettingsGroup,
  type SettingsSectionId,
} from '../features/settings/settingsSections';
import { OrganizationSettings } from '../features/org/OrganizationSettings';
import {
  canManageSelectedOrganization,
  getEnterpriseRole,
  hasOrganizationAdminAccess,
} from '../lib/organizationAccess';
import { EnterpriseSettings } from '../features/enterprise/EnterpriseSettings';
import { ActivityLog } from '../features/activity/ActivityLog';
import { RedmineHiddenSuggestions } from '../features/tickets/redmine/RedmineHiddenSuggestions';
import { invalidateSuggestionsCache } from '../features/tickets/redmine/useRedmineSuggestions';
import { GitHubConnectionRow } from './GitHubConnectionRow';
import { PROFILE_BIO_MAX, PROFILE_DISPLAY_NAME_MAX, PROFILE_WEBSITE_MAX } from '../lib/constants';
import { useTeam } from '../lib/TeamContext';
import { useBrand, BRANDS } from '../lib/useBrand';
import { notifyRedmineChanged } from '../lib/useRedmineStatus';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { AppPage } from './AppPage';
import { UserAvatar } from './UserAvatar';
import { useQueryParam, useRouter } from './router';

// Loaded when opened: Usage carries the data grid, and Seeder the YAML parser
// and presets, which production never shows.
const OrgUsage = React.lazy(() =>
  import('../features/usage/OrgUsage').then((m) => ({ default: m.OrgUsage })),
);
const Seeder = React.lazy(() =>
  import('../features/seeder/Seeder').then((m) => ({ default: m.Seeder })),
);

// ─── Primitives ───────────────────────────────────────────────────────────────

/** One card in a section. Untitled when the section heading already says it all. */
const Section: React.FC<{
  title?: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <Card padding="none">
    {title && (
      <CardHeader className="flex flex-col gap-0 px-5 py-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && (
          <Text variant="muted" size="xs">
            {description}
          </Text>
        )}
      </CardHeader>
    )}
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
  // On native, push is always supported (via Capacitor plugin); on web, check browser APIs.
  const [supported, setSupported] = useState(isNative);
  const [enabled, setEnabled] = useState(false);
  const [enableLoading, setEnableLoading] = useState(false);
  const [disableLoading, setDisableLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  // VAPID check is only relevant on the web; always pass on native.
  const [serverHasVapid, setServerHasVapid] = useState<boolean | null>(isNative ? true : null);

  const refreshStatus = useCallback(async () => {
    if (isNative) {
      try {
        const { receive } = await PushNotifications.checkPermissions();
        setEnabled(receive === 'granted' && isNativePushRegistered());
      } catch {
        setEnabled(false);
      }
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
    if (!isNative) {
      // On web, check if browser supports push APIs
      setSupported(isPushSupported());
      // VAPID key is configured if the env var is present
      const vapidKey =
        (typeof import.meta !== 'undefined' &&
          (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
        '';
      setServerHasVapid(vapidKey.length > 0);
    }
    // On native, supported is already true from useState(isNative)
    void refreshStatus();
  }, [isNative]);

  const handleEnable = async () => {
    setEnableLoading(true);
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

      if (msg.includes('iOS simulator')) {
        detail += msg + '\n\nPush notifications require a physical iOS device.';
      } else if (msg.includes('permission') || msg.includes('denied')) {
        detail += 'Please allow notifications in your browser settings.';
      } else if (msg.includes('not-configured')) {
        detail += 'The server is missing VAPID keys in settings.';
      } else if (msg.includes('Timed out waiting for push')) {
        if (isNative) {
          detail += 'Unable to connect to Apple Push Notification service. Please check:\n\n';
          detail += '1. Your device has an active internet connection\n';
          detail += '2. You are not using a VPN that blocks APNs\n';
          detail += '3. Try restarting the app and trying again\n\n';
          detail +=
            'If the issue persists, push notifications may not be available in your region or network.';
        } else {
          detail += 'Service worker registration timed out. Please refresh the page and try again.';
        }
      } else {
        detail += msg;
      }

      window.alert(detail);
    } finally {
      setEnableLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm('Are you sure you want to disable push notifications?')) return;
    setDisableLoading(true);
    try {
      await unsubscribeFromPush();
      if (!isNative) await refreshStatus();
      else setEnabled(false);

      window.alert('Notifications disabled.');
    } catch {
      window.alert('Failed to disable notifications. Please try again.');
    } finally {
      setDisableLoading(false);
    }
  };

  const handleTestPush = async () => {
    setTestLoading(true);
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
      setTestLoading(false);
    }
  };

  console.log('[PushSettings]', { isNative, supported, enabled, serverHasVapid });

  return (
    <>
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
              disabled={disableLoading}
              isLoading={disableLoading}
            >
              Disable notifications
            </Button>
          </>
        ) : (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
              Enable push notifications to get notified when your team members clock in or clock
              out.
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleEnable}
              disabled={enableLoading || serverHasVapid === false}
              isLoading={enableLoading}
              leftIcon={<BellIcon className="h-3.5 w-3.5" />}
            >
              Enable notifications
            </Button>
          </>
        )}
      </div>
      {/* Sends an in-app notification too, so it works before push is enabled. */}
      <Row label="Send a test notification" hint="Check that alerts reach you.">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestPush}
          disabled={testLoading}
          isLoading={testLoading}
        >
          Send test notification
        </Button>
      </Row>
    </>
  );
};

// ─── Profile editor ───────────────────────────────────────────────────────────

const ProfileEditor: React.FC<{ refreshTrigger?: number }> = ({ refreshTrigger }) => {
  const { user, refetch } = useSession();
  // Reports To is account-wide, so use every team, not just the selected organization's.
  const { allTeams, teamsReady } = useTeam();
  // Rerun the teammate lookup only when the set of shared teams changes.
  const sharedTeamIds = React.useMemo(
    () =>
      allTeams
        .filter((team) => !team.isPersonal)
        .map((team) => team.id)
        .sort()
        .join(','),
    [allTeams],
  );
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
  }, [user?.id, refreshTrigger]);

  useEffect(() => {
    if (!user?.id || !teamsReady) return;
    let cancelled = false;

    void (async () => {
      try {
        const nonPersonalTeamIds = sharedTeamIds ? sharedTeamIds.split(',') : [];

        if (nonPersonalTeamIds.length === 0) {
          if (!cancelled) {
            setReportsToOptions([{ value: '', label: 'No manager or lead set' }]);
          }
          return;
        }

        const memberLists = await Promise.all(
          nonPersonalTeamIds.map((teamId) => teamApi.getMembers(teamId)),
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
  }, [user?.id, teamsReady, sharedTeamIds]);

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
        <div className="flex min-h-9 items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800">
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
          <div className="flex min-h-9 items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 dark:border-neutral-700 dark:bg-neutral-800">
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

// ─── API Tokens Manager ───────────────────────────────────────────────────────

const ApiTokensManager: React.FC = () => {
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTokenName, setNewTokenName] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await tokenApi.list();
      setTokens(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    const name = newTokenName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    setCreatedToken(null);
    try {
      const result = await tokenApi.create(name);
      setCreatedToken(result.token);
      setNewTokenName('');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create token');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await tokenApi.revoke(id);
      setTokens((prev) => prev.filter((t) => t._id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token');
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy — please copy the token manually.');
    }
  };

  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {/* Create new token */}
      <div className="flex flex-col gap-3 px-5 py-4">
        <Text size="xs" weight="medium">
          Generate new token
        </Text>
        <div className="flex gap-2">
          <Input
            placeholder="Token name (e.g. TimeHarbor)"
            value={newTokenName}
            onChange={(e) => setNewTokenName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            className="flex-1 text-sm h-8"
            size="sm"
          />
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!newTokenName.trim() || creating}
            isLoading={creating}
            loadingText="Creating…"
            className="h-8"
          >
            Generate
          </Button>
        </div>
        {error && (
          <Text size="xs" className="text-red-500">
            {error}
          </Text>
        )}
      </div>

      {/* One-time token reveal */}
      {createdToken && (
        <div className="flex flex-col gap-2 bg-amber-50 px-5 py-4 dark:bg-amber-950/30">
          <Text size="xs" weight="medium" className="text-amber-700 dark:text-amber-400">
            Save this token now — it won't be shown again.
          </Text>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800">
              {createdToken}
            </code>
            <Button size="sm" variant="outline" onClick={() => void handleCopy()}>
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {/* Token list */}
      {loading ? (
        <div className="px-5 py-3">
          <Text variant="muted" size="xs">
            Loading…
          </Text>
        </div>
      ) : tokens.length === 0 ? (
        <div className="px-5 py-3">
          <Text variant="muted" size="xs">
            No tokens yet.
          </Text>
        </div>
      ) : (
        tokens.map((t) => (
          <div key={t._id} className="flex items-center justify-between px-5 py-3">
            <div className="flex flex-col gap-0.5">
              <Text size="xs" weight="medium">
                {t.name}
              </Text>
              <Text variant="muted" size="xs">
                Created {new Date(t.createdAt).toLocaleDateString()}
                {t.lastUsedAt
                  ? ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                  : ' · Never used'}
              </Text>
            </div>
            <Button size="sm" variant="danger" onClick={() => void handleRevoke(t._id)}>
              Revoke
            </Button>
          </div>
        ))
      )}
    </div>
  );
};

// ─── Redmine connection ─────────────────────────────────────────────────────

const RedmineConnection: React.FC = () => {
  const [status, setStatus] = useState<RedmineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await redmineApi.status();
      setStatus(next);
      setBaseUrl(next.defaultBaseUrl ?? '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Redmine status');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Issue ids mean nothing across Redmine instances, so the URL can only change
  // between shifts. The server enforces this too; locking the field says so up front.
  const isClockedIn = Boolean(useTeam().activeClockEvent);
  const showUrlField = Boolean(status?.customUrlAllowed);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      // Locked while clocked in: send nothing, so the server keeps its default.
      const url = showUrlField && !isClockedIn ? baseUrl.trim() : undefined;
      const next = await redmineApi.connect(key, url);
      setStatus(next);
      setApiKey('');
      // The search bar caches its suggestions (or "not connected") for the
      // session; the link just changed what they should be.
      invalidateSuggestionsCache();
      // The tickets page stays mounted behind this route and will not refetch
      // on its own, so tell it the link changed (#562).
      notifyRedmineChanged(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Redmine');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await redmineApi.disconnect();
      setStatus(next);
      // Drop the cached suggestions too, so their issue titles go with the link.
      invalidateSuggestionsCache();
      setBaseUrl(next.defaultBaseUrl ?? '');
      notifyRedmineChanged(next);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="px-5 py-4">
        <Text variant="muted" size="xs">
          Loading…
        </Text>
      </div>
    );
  }

  if (status?.connected) {
    return (
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Badge variant="success">Connected</Badge>
            <div className="min-w-0">
              <Text size="sm" weight="medium" className="truncate">
                {status.redmineName || status.redmineLogin}
              </Text>
              {status.redmineLogin && (
                <Text variant="muted" size="xs" className="truncate">
                  @{status.redmineLogin}
                  {status.baseUrl ? ` · ${status.baseUrl}` : ''}
                </Text>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDisconnect()}
            disabled={busy}
            isLoading={busy}
            loadingText="Disconnecting…"
          >
            Disconnect
          </Button>
        </div>

        <RedmineHiddenSuggestions />

        {error && (
          <Text size="xs" variant="destructive" role="alert">
            {error}
          </Text>
        )}
      </div>
    );
  }

  // No server to link to: a key could only be refused, so say why up front.
  // Only on an answer: a failed status read shows its error below instead.
  if (status && !status.defaultBaseUrl && !showUrlField) {
    return (
      <div className="redmine-not-configured px-5 py-4">
        <Text variant="muted" size="xs" role="status">
          This TimeHuddle has no Redmine server set up yet. Whoever runs it sets one with{' '}
          <code className="text-xs">REDMINE_BASE_URL</code>.
        </Text>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <Text variant="muted" size="xs">
        Paste your personal Redmine API key (found on your Redmine account page under{' '}
        <code className="text-xs">My account</code>) to link your account
        {status?.defaultBaseUrl && !showUrlField ? ` on ${status.defaultBaseUrl}` : ''}.
      </Text>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="Redmine API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            // Guard against key-repeat launching concurrent validate/upsert
            // requests while one is already in flight.
            if (e.key === 'Enter' && !busy) void handleConnect();
          }}
          disabled={busy}
          className="flex-1 h-8 text-sm"
          size="sm"
          aria-label="Redmine API key"
        />
        <Button
          size="sm"
          onClick={() => void handleConnect()}
          disabled={!apiKey.trim() || busy}
          isLoading={busy}
          loadingText="Connecting…"
          className="h-8"
        >
          Connect
        </Button>
      </div>
      {showUrlField && (
        <Input
          type="url"
          label="Redmine URL"
          placeholder="https://redmine.example.com"
          value={isClockedIn ? (status?.defaultBaseUrl ?? '') : baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void handleConnect();
          }}
          disabled={busy || isClockedIn}
          helperText={
            isClockedIn
              ? 'Clock out to connect to a different Redmine instance.'
              : 'The Redmine instance your API key belongs to. Test deployments only.'
          }
          className="redmine-base-url h-8 text-sm"
          size="sm"
        />
      )}
      {error && (
        <Text size="xs" variant="destructive" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
};

// ─── Account and privacy ──────────────────────────────────────────────────────

const AccountSettings: React.FC = () => {
  const { signOut } = useSession();
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Change-password form state
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwNew !== pwConfirm) {
      setPwMessage({ ok: false, text: 'New passwords do not match.' });
      return;
    }
    if (pwNew.length < 8) {
      setPwMessage({ ok: false, text: 'New password must be at least 8 characters.' });
      return;
    }
    setPwBusy(true);
    setPwMessage(null);
    try {
      const ddp = getDdpClient();
      // Ensure the DDP connection is authenticated before the call. The socket
      // may have reconnected (e.g. after a server restart) without re-logging
      // in, which would make the method see a null userId ("Must be logged in").
      await ddp.ensureAuthed();
      await ddp.call('accounts.changePassword', {
        currentPassword: pwCurrent,
        newPassword: pwNew,
      });
      setPwMessage({ ok: true, text: 'Password changed. Signing you out…' });
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      setShowChangePassword(false);
      // Password change invalidates all sessions — sign out so the user signs
      // back in with their new password.
      setTimeout(() => void signOut(), 1200);
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : 'Failed to change password.';
      // A dead/expired session can't change its password — force a clean sign-out
      // so the user can re-authenticate instead of being stuck.
      if (/logged in|not-authorized|Must be logged/i.test(text)) {
        setPwMessage({ ok: false, text: 'Your session expired. Please sign in again.' });
        setTimeout(() => void signOut(), 1500);
      } else {
        setPwMessage({ ok: false, text });
      }
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <Section title="Sign-in">
        <GitHubConnectionRow />
        <Row label="Change password" hint="Update your password without needing email">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshIcon className="h-3.5 w-3.5" />}
            onClick={() => {
              setShowChangePassword((v) => !v);
              setPwMessage(null);
            }}
          >
            {showChangePassword ? 'Cancel' : 'Change password'}
          </Button>
        </Row>
        {showChangePassword && (
          <div className="px-5 pb-4">
            <form onSubmit={(e) => void handleChangePassword(e)} className="flex flex-col gap-3">
              <Input
                type="password"
                placeholder="Current password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
              <Input
                type="password"
                placeholder="New password (min 8 characters)"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                required
                autoComplete="new-password"
              />
              <Input
                type="password"
                placeholder="Confirm new password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
              {pwMessage && (
                <Text variant={pwMessage.ok ? 'success' : 'destructive'} size="xs">
                  {pwMessage.text}
                </Text>
              )}
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={pwBusy}
                loadingText="Saving…"
                disabled={!pwCurrent || !pwNew || !pwConfirm || pwBusy}
              >
                Save new password
              </Button>
            </form>
          </div>
        )}
        {pwMessage && !showChangePassword && (
          <div className="px-5 pb-3">
            <Text variant={pwMessage.ok ? 'success' : 'destructive'} size="xs">
              {pwMessage.text}
            </Text>
          </div>
        )}
      </Section>

      <Section>
        <Row label="Sign out" hint="You will be returned to the login screen">
          <Button
            variant="danger"
            size="sm"
            leftIcon={<LogOutIcon className="h-3.5 w-3.5" />}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </Row>
        <Row
          label="Delete account"
          hint="Permanently delete your account and all associated data. This cannot be undone."
        >
          <Button
            variant="danger"
            size="sm"
            leftIcon={<TrashIcon className="h-3.5 w-3.5" />}
            disabled={deleteBusy}
            isLoading={deleteBusy}
            loadingText="Deleting…"
            onClick={async () => {
              if (
                !window.confirm(
                  'Delete your account permanently?\n\nAll your data will be removed. This cannot be undone.',
                )
              )
                return;
              setDeleteBusy(true);
              try {
                await userApi.deleteAccount();
                await signOut();
              } catch (err: unknown) {
                window.alert(
                  err instanceof Error
                    ? err.message
                    : 'Failed to delete account. Please try again.',
                );
              } finally {
                setDeleteBusy(false);
              }
            }}
          >
            Delete account
          </Button>
        </Row>
      </Section>
    </>
  );
};

// ─── Overview ─────────────────────────────────────────────────────────────────

/** A full-width row that opens a section: icon or avatar, label over detail, chevron. */
const OverviewRow: React.FC<{
  /** The section this row opens; the page returns focus here when you come back. */
  sectionId: SettingsSectionId;
  leading: React.ReactNode;
  label: string;
  detail: string;
  onOpen: () => void;
}> = ({ sectionId, leading, label, detail, onOpen }) => (
  <Button
    variant="ghost"
    onClick={onOpen}
    data-settings-section={sectionId}
    leftIcon={<span className="settings-overview-leading flex shrink-0">{leading}</span>}
    rightIcon={<ChevronRightIcon className="h-4 w-4 shrink-0 text-neutral-400" />}
    // The label slot truncates and hugs its text by default; here it fills the
    // row, so the chevron sits at the end, and wraps a long detail line.
    className="settings-overview-row h-auto min-h-13 w-full justify-start gap-3 rounded-none px-5 py-3 text-left [&>[data-slot=button-label]]:flex-1 [&>[data-slot=button-label]]:whitespace-normal"
  >
    <span className="settings-overview-text min-w-0 flex-1">
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs font-normal text-neutral-500 dark:text-neutral-400">
        {detail}
      </span>
    </span>
  </Button>
);

/** The phone's Settings menu: who you are (which opens Profile), then every other section. */
const SettingsMenu: React.FC<{
  groups: SettingsGroup[];
  onOpen: (id: SettingsSectionId) => void;
}> = ({ groups, onOpen }) => {
  const { user } = useSession();
  return (
    <nav aria-label={SETTINGS_PAGE_STRINGS.navLabel} className="settings-menu space-y-4">
      <Section>
        <OverviewRow
          leading={<UserAvatar name={user?.name || user?.email || ''} src={user?.image} />}
          label={user?.name || user?.email || ''}
          detail={user?.email ?? ''}
          sectionId="profile"
          onOpen={() => onOpen('profile')}
        />
      </Section>
      {groups.map((group) => (
        <div key={group.label} className="settings-menu-group">
          <NavGroupLabel label={group.label} />
          <Section>
            {group.sections
              .filter((item) => item.id !== 'profile')
              .map((item) => (
                <OverviewRow
                  key={item.id}
                  sectionId={item.id}
                  leading={<item.icon className="h-4 w-4" />}
                  label={item.label}
                  detail={item.description}
                  onOpen={() => onOpen(item.id)}
                />
              ))}
          </Section>
        </div>
      ))}
      {!hasAdminGroup(groups) && <AdminNote />}
    </nav>
  );
};

const NavGroupLabel: React.FC<{ label: string }> = ({ label }) => (
  <Text
    size="xs"
    weight="semibold"
    variant="muted"
    className="settings-nav-group mb-1 px-2.5 uppercase tracking-widest"
  >
    {label}
  </Text>
);

const hasAdminGroup = (groups: SettingsGroup[]) =>
  groups.some((group) => group.label === SETTINGS_PAGE_STRINGS.administration);

/** Tells people without an Administration group where team and org settings went. */
const AdminNote: React.FC = () => (
  <Text
    variant="muted"
    size="xs"
    className="settings-admin-note rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700"
  >
    {SETTINGS_PAGE_STRINGS.adminNote}
  </Text>
);

// ─── SettingsPage ─────────────────────────────────────────────────────────────

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

export const SettingsPage: React.FC = () => {
  const { refetch } = useSession();
  const { navigate } = useRouter();
  const { organizations, selectedOrgId, enterprises, selectedEnterpriseId } = useTeam();
  const groups = settingsGroups(
    {
      organization: canManageSelectedOrganization(organizations, enterprises, selectedOrgId),
      enterprise: getEnterpriseRole(enterprises, selectedEnterpriseId) !== null,
      usage: hasOrganizationAdminAccess(organizations),
    },
    import.meta.env.MODE !== 'production',
  );
  const [sectionParam, setSectionParam] = useQueryParam('section', { mode: 'push' });
  const phone = useMediaQuery('(max-width: 767px)');
  // A side nav needs something beside it, so desktop opens on Profile; a phone opens on the menu.
  const section =
    resolveSettingsSection(sectionParam, groups) ?? (phone ? null : PERSONAL_SECTIONS[0]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // On a phone the menu and a section replace each other, so the focused
  // button disappears either way. Move focus to the section's heading when it
  // opens, and back to the row it came from on return (Back included). Never
  // on the first render: opening the page should not move focus.
  const lastOpenedRef = useRef<SettingsSectionId | null>(null);
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      lastOpenedRef.current = section?.id ?? null;
      return;
    }
    if (!phone) return;
    if (section) {
      lastOpenedRef.current = section.id;
      document.getElementById('settings-section-title')?.focus();
    } else if (lastOpenedRef.current) {
      document
        .querySelector<HTMLElement>(`[data-settings-section="${lastOpenedRef.current}"]`)
        ?.focus();
    }
  }, [phone, section?.id]);

  useRefresh(
    useCallback(async () => {
      await refetch();
      setRefreshTrigger((prev) => prev + 1);
    }, [refetch]),
  );

  const content: Record<SettingsSectionId, React.ReactNode> = {
    profile: (
      <Section>
        <ProfileEditor refreshTrigger={refreshTrigger} />
      </Section>
    ),
    appearance: (
      <Section title="Theme">
        <DarkModeRow />
        <Row label="Brand theme" hint="Switch between brand themes">
          <BrandSelector />
        </Row>
      </Section>
    ),
    notifications: (
      <Section
        title="Push notifications"
        description="Alerts on this device when a teammate clocks in or out."
      >
        <PushNotificationsSettings />
      </Section>
    ),
    api: (
      <Section>
        <ApiTokensManager />
      </Section>
    ),
    integrations: (
      <Section title="Redmine" description="Link your personal Redmine account with your API key.">
        <RedmineConnection />
      </Section>
    ),
    activity: (
      <Section>
        <ActivityLog />
      </Section>
    ),
    account: <AccountSettings />,
    // Keyed by org, so a slow response for the previous one can't overwrite it.
    organization: <OrganizationSettings key={selectedOrgId ?? 'none'} />,
    enterprise: <EnterpriseSettings />,
    usage: <OrgUsage />,
    seeder: <Seeder />,
  };

  return (
    <AppPage width="wide">
      {/* Desktop: side nav and version on the left, the section beside them.
          Phone: the menu, or one section with a back button to it. */}
      <div className="settings-layout flex flex-col gap-6 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:items-start md:gap-x-8">
        <nav
          aria-label={SETTINGS_PAGE_STRINGS.navLabel}
          className="settings-nav hidden space-y-4 md:block"
        >
          {groups.map((group) => (
            <div key={group.label} className="settings-nav-group-block">
              <NavGroupLabel label={group.label} />
              <ul className="settings-nav-list flex flex-col gap-1">
                {group.sections.map((item) => {
                  const current = item.id === section?.id;
                  return (
                    <li key={item.id}>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-current={current ? 'page' : undefined}
                        leftIcon={<item.icon className="h-4 w-4" />}
                        onClick={() => setSectionParam(item.id)}
                        // The app nav's active look, so "you are here" reads the same everywhere.
                        className={cn(
                          'settings-nav-item w-full justify-start',
                          current &&
                            'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-400',
                        )}
                      >
                        {item.label}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {!hasAdminGroup(groups) && <AdminNote />}
        </nav>

        {section ? (
          <section
            aria-labelledby="settings-section-title"
            className="settings-panel min-w-0 space-y-4 md:row-span-2"
          >
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<ChevronLeftIcon className="h-4 w-4" />}
              onClick={() => setSectionParam(null)}
              className="settings-back -ml-2 min-h-11 md:hidden"
            >
              {SETTINGS_PAGE_STRINGS.backToOverview}
            </Button>
            <div className="settings-panel-header">
              <Text
                as="h2"
                id="settings-section-title"
                tabIndex={-1}
                size="lg"
                weight="semibold"
                className="focus:outline-none"
              >
                {section.label}
              </Text>
              <Text variant="muted" size="sm">
                {section.description}
              </Text>
            </div>
            <React.Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <Spinner size="md" />
                </div>
              }
            >
              {content[section.id]}
            </React.Suspense>
          </section>
        ) : (
          <SettingsMenu groups={groups} onOpen={setSectionParam} />
        )}

        {/* On a phone the version closes the menu, not every section. */}
        <Text
          variant="muted"
          size="xs"
          className={cn('settings-version px-2.5', section && 'max-md:hidden')}
        >
          {SETTINGS_PAGE_STRINGS.version(APP_VERSION)} ·{' '}
          <Button variant="link" size="sm" onClick={() => navigate('/app/release-notes')}>
            {SETTINGS_PAGE_STRINGS.whatsNew}
          </Button>
        </Text>
      </div>
    </AppPage>
  );
};
