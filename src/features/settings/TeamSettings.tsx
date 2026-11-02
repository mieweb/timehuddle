/**
 * TeamSettings — Settings → Team, for admins of a team in the selected
 * organization (and its owners): the same team settings the Teams page's
 * Settings tab edits, with a picker when they manage more than one team.
 */
import { Button, Card, CardContent, Select } from '@mieweb/ui';
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
  const { selectedTeamId, setSelectedTeamId } = useTeam();
  const { navigate } = useRouter();
  const manageable = useManageableTeams();
  // The team in scope (`?team=`) when this user manages it, else their first.
  const team = manageable.find((t) => t.id === selectedTeamId) ?? manageable[0];
  if (!team) return null;

  return (
    <Card padding="lg" className="team-settings-card">
      <CardContent className="space-y-6">
        {manageable.length > 1 && (
          <Select
            label={SETTINGS_STRINGS.teamPicker}
            helperText={SETTINGS_STRINGS.teamPickerHint}
            size="sm"
            value={team.id}
            options={manageable.map((t) => ({ value: t.id, label: t.name }))}
            onValueChange={(id) => setSelectedTeamId(id)}
            className="team-settings-picker"
          />
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
