/**
 * TeamSettings — Settings → Team, for admins of a team in the selected
 * organization (and its owners): the same team settings the Teams page's
 * Settings tab edits, with a picker when they manage more than one team.
 *
 * It always edits the selected team, the one in the header and in `?team=`
 * (TeamContext treats this section as team-scoped). When that is a team the
 * viewer doesn't manage, it says so and offers the ones they do.
 */
import { Button, Card, CardContent, Select, Text } from '@mieweb/ui';
import React, { useMemo } from 'react';

import { canManageTeam } from '../../lib/organizationAccess';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';
import { TeamSettingsRows } from './TeamSettingsRows';
import { SETTINGS_STRINGS } from './settingsCopy';

/** The selected organization's teams whose settings this user can change. */
export function useManageableTeams() {
  const { user } = useSession();
  const { teams, organizations } = useTeam();
  const userId = user?.id ?? null;
  return useMemo(
    () => teams.filter((t) => !t.isPersonal && canManageTeam(t, userId, organizations)),
    [teams, userId, organizations],
  );
}

export const TeamSettings: React.FC = () => {
  const { selectedTeam, setSelectedTeamId } = useTeam();
  const { navigate } = useRouter();
  const manageable = useManageableTeams();
  const team = manageable.find((t) => t.id === selectedTeam?.id);
  if (!manageable.length) return null;

  return (
    <Card padding="lg" className="team-settings-card">
      <CardContent className="space-y-6">
        {!team && (
          <Text variant="muted" size="sm" className="team-settings-not-managed">
            {SETTINGS_STRINGS.notManagedTeam(selectedTeam?.name)}
          </Text>
        )}
        {/* Always name the team the switches change. */}
        {manageable.length > 1 || !team ? (
          <Select
            label={SETTINGS_STRINGS.teamPicker}
            helperText={SETTINGS_STRINGS.teamPickerHint}
            placeholder={SETTINGS_STRINGS.teamPickerPlaceholder}
            size="sm"
            value={team?.id ?? ''}
            options={manageable.map((t) => ({ value: t.id, label: t.name }))}
            onValueChange={(id) => setSelectedTeamId(id)}
            className="team-settings-picker"
          />
        ) : (
          <Text size="sm" className="team-settings-name">
            {SETTINGS_STRINGS.editingTeam(team.name)}
          </Text>
        )}
        {team && (
          <>
            {/* Keyed by team, so a save in flight can't show on the next team's switch. */}
            <TeamSettingsRows key={team.id} team={team} />
            <Button
              variant="link"
              size="sm"
              className="team-settings-manage"
              onClick={() => navigate(`/app/teams/${team.id}?tab=settings`)}
            >
              {SETTINGS_STRINGS.manageTeam}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
