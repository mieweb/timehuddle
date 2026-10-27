// The Settings page's sections and their copy, in one place until the app has i18n.
import {
  BellIcon,
  HistoryIcon,
  KeyIcon,
  LinkIcon,
  PaletteIcon,
  ShieldIcon,
  UserIcon,
  type LucideIcon,
} from '@mieweb/ui';

export type SettingsSectionId =
  'profile' | 'appearance' | 'notifications' | 'api' | 'integrations' | 'activity' | 'account';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** The Personal group, in nav order. */
export const PERSONAL_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Your name, bio and who you report to.',
    icon: UserIcon,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Dark mode and brand theme on this device.',
    icon: PaletteIcon,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Push alerts when teammates clock in or out.',
    icon: BellIcon,
  },
  {
    id: 'api',
    label: 'API tokens',
    description: 'Tokens for TimeHarbor and your own scripts.',
    icon: KeyIcon,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Your Redmine connection.',
    icon: LinkIcon,
  },
  {
    id: 'activity',
    label: 'Activity log',
    description: 'Your clock-ins, tickets and other actions, newest first.',
    icon: HistoryIcon,
  },
  {
    id: 'account',
    label: 'Account and privacy',
    description: 'Sign-in, password and deleting your account.',
    icon: ShieldIcon,
  },
];

export const SETTINGS_PAGE_STRINGS = {
  navLabel: 'Settings sections',
  backToOverview: 'Settings',
  personal: 'Personal',
  version: (version: string) => `Version ${version}`,
  whatsNew: 'What’s new',
} as const;

/** The section `?section=` names, or null for a missing or unknown value. */
export function resolveSettingsSection(value: string | null): SettingsSection | null {
  return PERSONAL_SECTIONS.find((section) => section.id === value) ?? null;
}

/** A link straight to one section of Settings. */
export function settingsPath(section: SettingsSectionId): string {
  return `/app/settings?section=${section}`;
}
