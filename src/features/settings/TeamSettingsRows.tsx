import { Text } from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';

import { teamApi, type Team, type TeamSettingKey } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { TeamSettingRow } from './TeamSettingRow';
import { PULSE_SETTING_KEYS, SETTINGS_STRINGS } from './settingsCopy';

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text variant="muted" size="xs" weight="semibold" className="mb-3 uppercase tracking-widest">
    {children}
  </Text>
);

// Semantic classes for the Pulse rows; e2e specs find a setting by its row's class.
const PULSE_ROW_CLASS = {
  pulseInApp: 'team-setting-pulse-in-app',
  pulseClockInOut: 'team-setting-pulse-clock',
  pulseSharedDevice: 'team-setting-pulse-shared-phones',
} as const;

/**
 * A team's own settings (plan requirement, auto-accept, Pulse), each with where its
 * value comes from. Shared by the Teams page's Settings tab and Settings → Team,
 * so both read and write the same team document.
 */
export const TeamSettingsRows: React.FC<{ team: Team }> = ({ team }) => {
  const { organizations, enterprises, refetchTeams } = useTeam();
  // The switch shows the value being saved until the server confirms it.
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<Partial<Record<TeamSettingKey, boolean>>>({});
  // A failed save's message, shown under the row that failed.
  const [error, setError] = useState<{ key: TeamSettingKey; message: string } | null>(null);

  // Names for "Inherited from …" / "Locked by …"; absent when the viewer can't see them.
  const names = useMemo(() => {
    const org = organizations.find((o) => o.id === team.orgId);
    return {
      org: org?.name,
      enterprise: enterprises.find((e) => e.id === org?.enterpriseId)?.name,
    };
  }, [organizations, enterprises, team.orgId]);

  // `value` null resets the setting to the inherited one.
  const update = useCallback(
    async (key: TeamSettingKey, value: boolean | null) => {
      setSaving(true);
      if (value !== null) setPending({ [key]: value });
      setError(null);
      try {
        await teamApi.updateSettings(team.id, { [key]: value });
        refetchTeams();
      } catch (e: any) {
        setError({ key, message: e.message || SETTINGS_STRINGS.failedToSave });
      } finally {
        setSaving(false);
        setPending({});
      }
    },
    [team.id, refetchTeams],
  );

  const row = (key: TeamSettingKey, className: string) => {
    const copy = SETTINGS_STRINGS.teamSettings[key];
    const setting = team.resolvedSettings[key];
    // The Pulse keys reach resolvedSettings only from a server whose publicTeamSettings
    // lists them; without them there is nothing to show or save, so no row.
    if (!setting) return null;
    return (
      <>
        <TeamSettingRow
          className={className}
          title={copy.title}
          description={copy.description}
          switchLabel={copy.switchLabel}
          setting={setting}
          names={names}
          checked={pending[key] ?? setting.value}
          saving={saving}
          onToggle={(checked) => void update(key, checked)}
          onReset={() => void update(key, null)}
        />
        {error?.key === key && (
          <Text variant="destructive" size="xs" className="mb-4" role="alert">
            {error.message}
          </Text>
        )}
      </>
    );
  };

  return (
    <div className="team-settings-rows">
      <GroupLabel>{SETTINGS_STRINGS.teamSettings.clockGroup}</GroupLabel>
      {row('requirePlanForClock', 'team-setting-plan-for-clock')}
      <GroupLabel>{SETTINGS_STRINGS.teamSettings.membershipGroup}</GroupLabel>
      {row('autoAcceptJoins', 'team-setting-auto-accept')}
      {PULSE_SETTING_KEYS.some((key) => team.resolvedSettings[key]) && (
        <>
          <GroupLabel>{SETTINGS_STRINGS.teamSettings.pulseGroup}</GroupLabel>
          {PULSE_SETTING_KEYS.map((key) => (
            <React.Fragment key={key}>{row(key, PULSE_ROW_CLASS[key])}</React.Fragment>
          ))}
        </>
      )}
    </div>
  );
};
