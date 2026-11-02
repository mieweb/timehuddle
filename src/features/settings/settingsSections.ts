// The Settings page's sections and their copy, in one place until the app has i18n.
import {
  BellIcon,
  BriefcaseIcon,
  BuildingIcon,
  ChartIcon,
  HistoryIcon,
  KeyIcon,
  LinkIcon,
  PaletteIcon,
  ShieldIcon,
  WrenchIcon,
  UserIcon,
  type LucideIcon,
} from '@mieweb/ui';

export type SettingsSectionId =
  | 'profile'
  | 'appearance'
  | 'notifications'
  | 'api'
  | 'integrations'
  | 'activity'
  | 'account'
  | 'organization'
  | 'enterprise'
  | 'usage'
  | 'seeder';

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
    description: 'Choose what notifies you, on desktop and on your phone.',
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

/** The Administration group, for people who manage that scope. */
export const ADMIN_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'organization',
    label: 'Organization',
    description: 'The defaults its teams inherit, and its ticket ID prefixes.',
    icon: BuildingIcon,
  },
  {
    id: 'enterprise',
    label: 'Enterprise',
    description: 'Its name, and the defaults its organizations and teams inherit.',
    icon: BriefcaseIcon,
  },
  {
    id: 'usage',
    label: 'Usage',
    description: 'Who is using TimeHuddle, how often, and what they use it for.',
    icon: ChartIcon,
  },
];

/** The Developers group, outside production only. */
export const DEVELOPER_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'seeder',
    label: 'Seeder',
    description: 'Import sample enterprises, organizations, teams and people from YAML.',
    icon: WrenchIcon,
  },
];

export interface SettingsGroup {
  label: string;
  sections: readonly SettingsSection[];
}

/**
 * The nav's groups for this viewer: Personal always, Administration for what
 * they manage, and Developers outside production.
 */
export function settingsGroups(
  manages: { organization: boolean; enterprise: boolean; usage: boolean },
  developer: boolean,
): SettingsGroup[] {
  const groups: SettingsGroup[] = [
    { label: SETTINGS_PAGE_STRINGS.personal, sections: PERSONAL_SECTIONS },
  ];
  const admin = ADMIN_SECTIONS.filter((section) => manages[section.id as keyof typeof manages]);
  if (admin.length) groups.push({ label: SETTINGS_PAGE_STRINGS.administration, sections: admin });
  if (developer)
    groups.push({ label: SETTINGS_PAGE_STRINGS.developers, sections: DEVELOPER_SECTIONS });
  return groups;
}

export const SETTINGS_PAGE_STRINGS = {
  navLabel: 'Settings sections',
  backToOverview: 'Back to Settings',
  personal: 'Personal',
  administration: 'Administration',
  developers: 'Developers',
  adminNote: 'Team and organization settings are managed by your admins.',
  version: (version: string) => `Version ${version}`,
  whatsNew: 'What’s new',
} as const;

/** The section `?section=` names among those this viewer has, or null. */
export function resolveSettingsSection(
  value: string | null,
  groups: SettingsGroup[],
): SettingsSection | null {
  return groups.flatMap((group) => group.sections).find((section) => section.id === value) ?? null;
}

/** A link straight to one section of Settings. */
export function settingsPath(section: SettingsSectionId): string {
  return `/app/settings?section=${section}`;
}
