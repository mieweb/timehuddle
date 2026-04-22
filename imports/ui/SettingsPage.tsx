/**
 * SettingsPage — User & application settings.
 * Sections:
 *   • Profile       — name (editable) + email (read-only)
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
  faRightFromBracket,
  faSun,
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
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  checkPushNotificationStatus,
  isPushNotificationSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '../lib/pushNotificationsClient';
import { useBrand, BRANDS } from '../lib/useBrand';
import { useSession } from '../lib/useSession';
import { useTheme } from '../lib/useTheme';
import { userApi } from '../lib/api';

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
          <Text variant="muted" size="xs" className="mt-0.5">{description}</Text>
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
      <Text size="sm" weight="medium">{label}</Text>
      {hint && <Text variant="muted" size="xs" className="mt-0.5">{hint}</Text>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

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
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverHasVapid, setServerHasVapid] = useState<boolean | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!isPushNotificationSupported()) {
      setEnabled(false);
      return;
    }
    const st = await checkPushNotificationStatus();
    setEnabled(st.permission === 'granted' && st.subscribed && st.serverEnabled);
  }, []);

  useEffect(() => {
    setSupported(isPushNotificationSupported());
    // VAPID key is configured if the env var is present
    const vapidKey =
      (typeof import.meta !== 'undefined' &&
        (import.meta as { env?: Record<string, string> }).env?.VITE_VAPID_PUBLIC_KEY) ||
      '';
    setServerHasVapid(vapidKey.length > 0);
    void refreshStatus();
  }, [refreshStatus]);

  const handleEnable = async () => {
    setLoading(true);
    try {
      await subscribeToWebPush();
      await refreshStatus();
       
      window.alert('Notifications enabled! You will receive alerts when team members clock in or out.');
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
      await unsubscribeFromWebPush();
      await refreshStatus();
       
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
          Web Push is not configured on this server. Add VAPID keys to <code className="text-xs">settings.json</code>{' '}
          (see <code className="text-xs">settings.push.example.json</code>).
        </div>
      )}
      {!supported ? (
        <Text variant="muted" size="sm">
          Push notifications are not supported in this browser. Try Chrome, Firefox, or Edge.
        </Text>
      ) : enabled ? (
        <>
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
            Notifications are enabled. You will receive alerts when team members clock in or out.
          </div>
          <Button variant="outline" size="sm" onClick={handleDisable} disabled={loading} isLoading={loading}>
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
  const email = user?.email;

  // Split display name into first/last for the edit fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  useEffect(() => {
    if (user?.name) {
      const [first = '', ...rest] = user.name.split(' ');
      setFirstName(first);
      setLastName(rest.join(' '));
    }
  }, [user?.name]);

  const [saved, setSaved] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const { refetch } = useSession();

  const handleSaveProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const name = [firstName, lastName].filter(Boolean).join(' ').trim();
      if (!name) {
        setProfileError('Name cannot be empty');
        setProfileLoading(false);
        return;
      }
      await userApi.updateProfile({ name });
      await refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setProfileLoading(false);
    }
  }, [firstName, lastName, refetch]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8">
      {/* Profile */}
      <Section
        icon={faCircleUser}
        title="Profile"
        description="Your account information."
      >
        <Row label="First name">
          <Input
            label="First name"
            hideLabel
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            size="sm"
          />
        </Row>
        <Row label="Last name">
          <Input
            label="Last name"
            hideLabel
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            size="sm"
          />
        </Row>
        <Row label="Email address" hint="Read-only">
          <Badge variant="secondary">{email ?? '—'}</Badge>
        </Row>
        <div className="flex items-center gap-3 px-5 py-3">
          <Button
            variant="primary"
            onClick={handleSaveProfile}
            isLoading={profileLoading}
            loadingText="Saving…"
          >
            Save Profile
          </Button>
          {saved && <Text variant="success" size="xs">Saved!</Text>}
          {profileError && <Text variant="destructive" size="xs">{profileError}</Text>}
        </div>
      </Section>

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
    </div>
  );
};
