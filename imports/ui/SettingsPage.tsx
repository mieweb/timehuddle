/**
 * SettingsPage — User & application settings.
 *
 * Sections:
 *   • Profile       — name (editable) + email (read-only)
 *   • Appearance    — theme toggle
 *   • Account       — sign out
 *   • About         — stack versions
 */
import {
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
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import React, { useState, useCallback } from 'react';

import { useBrand, BRANDS } from '../lib/useBrand';
import { useMethod } from '../lib/useMethod';
import { useTheme } from '../lib/useTheme';

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

// ─── SettingsPage ─────────────────────────────────────────────────────────────

export const SettingsPage: React.FC = () => {
  const user = useTracker(() => Meteor.user());
  const profile = user?.profile as { firstName?: string; lastName?: string; email?: string } | undefined;
  const email: string | undefined = user?.emails?.[0]?.address ?? profile?.email;

  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [saved, setSaved] = useState(false);
  const updateProfile = useMethod<[{ firstName: string; lastName: string }]>('updateUserProfile');

  const handleSaveProfile = useCallback(async () => {
    await updateProfile.call({ firstName: firstName.trim(), lastName: lastName.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [firstName, lastName, updateProfile]);

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
            isLoading={updateProfile.loading}
            loadingText="Saving…"
          >
            Save Profile
          </Button>
          {saved && <Text variant="success" size="xs">Saved!</Text>}
          {updateProfile.error && <Text variant="destructive" size="xs">{updateProfile.error}</Text>}
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

      {/* Account */}
      <Section icon={faGear} title="Account">
        <Row label="Sign out" hint="You will be returned to the login screen">
          <Button
            variant="danger"
            size="sm"
            leftIcon={<FontAwesomeIcon icon={faRightFromBracket} className="text-xs" />}
            onClick={() => Meteor.logout()}
          >
            Sign out
          </Button>
        </Row>
      </Section>

      {/* About */}
      <Section icon={faInfo} title="About" description="Stack versions for this application.">
        {(
          [
            ['Meteor', '3.5'],
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
