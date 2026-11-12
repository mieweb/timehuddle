// Every user-facing string for the settings UI, in one place until the app has i18n.
import type { ResolvedSetting } from '../../lib/api';

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

export const SOURCES_STRINGS = {
  description:
    'Connect each server with your own API key, found on your account page on that server.',
  empty: 'No servers are set up yet. An organization owner can register one in its settings.',
  loading: 'Loading…',
  mainServerName: 'Redmine',
  connected: 'Connected',
  notConnected: 'Not connected',
  rejected: "Couldn't reach",
  rejectedHelp:
    'This server rejected your API key. It may have been reset: paste your current key to reconnect.',
  keyPlaceholder: 'API key',
  keyLabel: (keyName: string, host: string) => `${keyName} for ${host}`,
  connect: 'Connect',
  connecting: 'Connecting…',
  connectLabel: (host: string) => `Connect to ${host}`,
  check: 'Check',
  checkLabel: (host: string) => `Check your key on ${host}`,
  keyWorks: 'Your key works.',
  disconnect: 'Disconnect',
  disconnectLabel: (host: string) => `Disconnect from ${host}`,
  connectGithub: 'Connect GitHub',
  githubAccess:
    "GitHub will ask for repo access. It's GitHub's only option for private repos and also covers code; TimeHuddle reads and updates only issues and pull requests.",
  githubOrgs:
    "An org's private repos show once its owner approves TimeHuddle. You can request that on GitHub, under your authorized apps.",
  githubOwnersLabel: 'Bring issues from',
  githubOwnersPlaceholder: 'All your accounts and organizations',
  githubOwnersHelp:
    'Assigned issues and search come from these. Leave it empty for all of them. Only issues updated in the last 8 days are suggested.',
  githubOwnersFailed: "Couldn't load your GitHub organizations. Try again.",
  githubOwnersSaveFailed: "Couldn't save that. Try again.",
  githubOwnLabel: (login: string) => `${login} (you)`,
  githubConnected: 'GitHub connected.',
  githubFailed: "Couldn't connect GitHub. Try again.",
  githubNotSetUp: "GitHub isn't set up on this TimeHuddle yet. Whoever runs it can add it.",
  urlLabel: 'Server URL',
  urlPlaceholder: 'https://redmine.example.com',
  urlHelp: 'The server your API key belongs to. Test deployments only.',
  urlLocked: 'Clock out to connect to a different server.',
  loadFailed: 'Failed to load your servers.',
  connectFailed: 'Failed to connect.',
  checkFailed: 'Failed to check your key.',
  disconnectFailed: 'Failed to disconnect.',
};
