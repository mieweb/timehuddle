// The Settings page's sections and their copy, in one place until the app has i18n.
import {
  faBell,
  faKey,
  faPalette,
  faPlug,
  faShieldHalved,
  faUser,
} from '@fortawesome/free-solid-svg-icons';

export type SettingsSectionId =
  'profile' | 'appearance' | 'notifications' | 'api' | 'integrations' | 'account';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: typeof faUser;
}

/** The Personal group, in nav order. The first is shown when the URL names none. */
export const PERSONAL_SECTIONS: readonly SettingsSection[] = [
  { id: 'profile', label: 'Profile', description: 'How you appear to your teams.', icon: faUser },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme and brand for this device.',
    icon: faPalette,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Choose what alerts you, and where.',
    icon: faBell,
  },
  {
    id: 'api',
    label: 'API tokens',
    description: 'Personal tokens for TimeHarbor and other tools.',
    icon: faKey,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connect the other tools you work in.',
    icon: faPlug,
  },
  {
    id: 'account',
    label: 'Account and privacy',
    description: 'Sign-in, sign-out and your account.',
    icon: faShieldHalved,
  },
];

export const SETTINGS_PAGE_STRINGS = {
  navLabel: 'Settings sections',
  personal: 'Personal',
  version: (version: string) => `Version ${version}`,
  whatsNew: 'What’s new',
} as const;

/** The section `?section=` names, or the first one for a missing or unknown value. */
export function resolveSettingsSection(value: string | null): SettingsSection {
  return PERSONAL_SECTIONS.find((section) => section.id === value) ?? PERSONAL_SECTIONS[0];
}

/** A link straight to one section of Settings. */
export function settingsPath(section: SettingsSectionId): string {
  return `/app/settings?section=${section}`;
}
