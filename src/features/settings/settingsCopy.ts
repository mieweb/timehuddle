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
