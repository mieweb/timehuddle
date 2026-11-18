// Every user-facing string for the settings UI, in one place until the app has i18n.
import type { PulseSettingKey, ResolvedSetting } from '../../lib/api';
import type { DefaultSettingRow } from './DefaultsCard';

export type SettingsLevel = 'team' | 'org' | 'enterprise';

/** Names for the org and enterprise a setting can come from, when the viewer can see them. */
export interface SourceNames {
  org?: string;
  enterprise?: string;
}

const LEVEL_NOUN: Record<SettingsLevel, string> = {
  team: 'team',
  org: 'organization',
  enterprise: 'enterprise',
};

export const SETTINGS_STRINGS = {
  setHere: (level: SettingsLevel) => `Set on this ${LEVEL_NOUN[level]}`,
  setAndLocked: (level: SettingsLevel) =>
    `Set on this ${LEVEL_NOUN[level]} and locked for everything below it`,
  inheritedFromParentTeam: 'Inherited from parent team',
  inheritedFromOrg: (name?: string) => `Inherited from ${name ?? 'the organization'}`,
  inheritedFromEnterprise: (name?: string) => `Inherited from ${name ?? 'the enterprise'}`,
  systemDefault: 'Default',
  lockedByOrg: (name?: string) => `Locked by ${name ?? 'the organization'}`,
  lockedByEnterprise: (name?: string) => `Locked by ${name ?? 'the enterprise'}`,
  notApplicablePersonal: 'Not applicable to personal teams',
  resetToInherited: 'Reset to inherited',
  lockForTeams: 'Lock for all teams',
  lockForOrgsAndTeams: 'Lock for all organizations and teams',
  failedToSave: 'Failed to update setting',
  teamSettings: {
    clockGroup: 'Clock',
    membershipGroup: 'Membership',
    requirePlanForClock: {
      title: 'Require a plan for every clock-in/out',
      description:
        'Members post a plan to start each session, and add a wrap-up to it before clocking out — one Huddle post per session.',
      switchLabel: 'Toggle requiring a plan for every clock-in and out',
    },
    autoAcceptJoins: {
      title: 'Auto-accept join requests',
      description:
        'Anyone joining with the team code is added immediately — no pending approval from an admin.',
      switchLabel: 'Toggle auto-accepting join requests',
    },
    pulseGroup: 'Pulse',
    pulseInApp: {
      title: 'Record with Pulse in the iPhone app',
      description:
        'Members record videos for tickets, sessions and posts with Pulse. Off hides the record buttons; videos already recorded still send.',
      switchLabel: 'Toggle recording with Pulse in the iPhone app',
    },
    pulseClockInOut: {
      title: 'Clock in and out with a Pulse video',
      description:
        'Members can record their plan or wrap-up as a Pulse video when they clock in or out in the iPhone app.',
      switchLabel: 'Toggle clocking in and out with a Pulse video',
    },
    pulseSharedDevice: {
      title: 'This team uses shared phones',
      description:
        'When someone signs out, videos they haven’t sent are deleted from the phone instead of kept for their next sign-in.',
      switchLabel: 'Toggle shared phones for this team',
    },
  },
  /** The Pulse defaults an organization or enterprise sets; each row adds who follows it. */
  pulseDefaults: {
    pulseInApp: {
      title: 'Record with Pulse in the iPhone app',
      description: 'Off hides the record buttons; videos already recorded still send.',
    },
    pulseClockInOut: {
      title: 'Clock in and out with a Pulse video',
      description: 'Members can record their plan or wrap-up as a Pulse video in the iPhone app.',
    },
    pulseSharedDevice: {
      title: 'Teams use shared phones',
      description: 'Videos not yet sent are deleted from the phone when someone signs out.',
    },
  },
  followsDefault: {
    org: 'Teams without their own choice follow this.',
    enterprise: 'Organizations and teams without their own choice follow this.',
  },
  teamPicker: 'Team',
  teamPickerHint: 'Which team’s settings to change.',
  editingTeam: (name: string) => `Settings for ${name}`,
  teamPickerPlaceholder: 'Choose a team',
  notManagedTeam: (name?: string) =>
    name
      ? `You don’t manage ${name}, so it has no settings you can change here. Choose a team you manage.`
      : 'Choose a team you manage.',
  manageTeam: 'Rename or delete this team',
} as const;

/** The Pulse settings, in the order every settings surface lists them. */
export const PULSE_SETTING_KEYS: readonly PulseSettingKey[] = [
  'pulseInApp',
  'pulseClockInOut',
  'pulseSharedDevice',
];

/** The Pulse rows of an organization's or enterprise's defaults, each lockable. */
export function pulseDefaultRows(level: Exclude<SettingsLevel, 'team'>): DefaultSettingRow[] {
  return PULSE_SETTING_KEYS.map((key) => ({
    key,
    title: SETTINGS_STRINGS.pulseDefaults[key].title,
    description: `${SETTINGS_STRINGS.followsDefault[level]} ${SETTINGS_STRINGS.pulseDefaults[key].description}`,
    lockable: true,
  }));
}

/** Settings → Sources → GitHub (#873): a member's own GitHub connection. */
export const GITHUB_SOURCE_STRINGS = {
  title: 'GitHub',
  description: 'Connect your GitHub account to work on your GitHub issues and pull requests here.',
  loading: 'Loading…',
  loadFailed: "Couldn't load your GitHub connection.",
  connected: 'Connected',
  notConnected: 'Not connected',
  rejected: "Couldn't reach",
  rejectedHelp: 'GitHub stopped accepting your connection. Connect again to fix it.',
  connect: 'Connect GitHub',
  connectFailed: "Couldn't start connecting GitHub. Try again.",
  disconnect: 'Disconnect',
  disconnectLabel: 'Disconnect GitHub',
  disconnectFailed: "Couldn't disconnect GitHub. Try again.",
  connectedAs: (login: string) => `Connected as @${login}`,
  access:
    "GitHub will ask for repo access. It's GitHub's only option for private repos and also covers code; TimeHuddle reads and updates only issues and pull requests.",
  orgs: "An org's private repos show once its owner approves TimeHuddle. You can request that on GitHub, under your authorized apps.",
  ownersLabel: 'Bring issues from',
  ownersPlaceholder: 'All your accounts and organizations',
  ownersHelp:
    'Assigned issues and search come from these. Leave it empty for all of them. Only issues updated in the last 8 days are suggested.',
  ownersFailed: "Couldn't load your GitHub organizations. Try again.",
  ownersSaveFailed: "Couldn't save that. Try again.",
  ownLabel: (login: string) => `${login} (you)`,
  justConnected: 'GitHub connected.',
  failed: "Couldn't connect GitHub. Try again.",
  notSetUp: "GitHub isn't set up on this TimeHuddle yet. Whoever runs it can add it.",
} as const;

/** One line saying where a setting's value comes from, as seen from `level`. */
export function describeSetting(
  setting: ResolvedSetting,
  level: SettingsLevel,
  names: SourceNames,
): string {
  const S = SETTINGS_STRINGS;
  if (setting.source === 'personal') return S.notApplicablePersonal;
  if (setting.locked && setting.source === level) return S.setAndLocked(level);
  if (setting.locked && setting.source === 'org') return S.lockedByOrg(names.org);
  if (setting.locked && setting.source === 'enterprise')
    return S.lockedByEnterprise(names.enterprise);
  switch (setting.source) {
    case 'parentTeam':
      return S.inheritedFromParentTeam;
    case 'org':
      return level === 'org' ? S.setHere(level) : S.inheritedFromOrg(names.org);
    case 'enterprise':
      return level === 'enterprise'
        ? S.setHere(level)
        : S.inheritedFromEnterprise(names.enterprise);
    case 'team':
      return S.setHere('team');
    default:
      return S.systemDefault;
  }
}
