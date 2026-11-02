/**
 * TeamSettings — Settings → Team, for admins of a team in the selected
 * organization (and its owners): the same team settings the Teams page's
 * Settings tab edits, with a picker when they manage more than one team.
 *
 * Settings is not a team-scoped page, so TeamContext ignores `?team=` here;
 * this section reads and writes it itself, so a link can name the team.
 */
import { Button, Card, CardContent, Select, Text } from '@mieweb/ui';
import React, { useMemo } from 'react';

import { canManageTeam } from '../../lib/organizationAccess';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useQueryParam, useRouter } from '../../ui/router';
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
  const { selectedTeamId, setSelectedTeamId } = useTeam();
  const { navigate } = useRouter();
  const [teamParam, setTeamParam] = useQueryParam('team');
  const manageable = useManageableTeams();
  // The team the link names, else the selected one, when this user manages
  // it; otherwise their first.
  const team =
    manageable.find((t) => t.id === teamParam) ??
    manageable.find((t) => t.id === selectedTeamId) ??
    manageable[0];
  if (!team) return null;

  const pickTeam = (id: string) => {
    setTeamParam(id);
    setSelectedTeamId(id);
  };

  return (
    <Card padding="lg" className="team-settings-card">
      <CardContent className="space-y-6">
        {/* Always name the team: it can differ from the one in the header. */}
        {manageable.length > 1 ? (
          <Select
            label={SETTINGS_STRINGS.teamPicker}
            helperText={SETTINGS_STRINGS.teamPickerHint}
            size="sm"
            value={team.id}
            options={manageable.map((t) => ({ value: t.id, label: t.name }))}
            onValueChange={pickTeam}
            className="team-settings-picker"
          />
        ) : (
          <Text size="sm" className="team-settings-name">
            {SETTINGS_STRINGS.editingTeam(team.name)}
          </Text>
        )}
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
      </CardContent>
    </Card>
  );
};
