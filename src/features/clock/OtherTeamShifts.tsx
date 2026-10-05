/**
 * OtherTeamShifts — "Also on the clock in Team A", with a switch.
 *
 * The clock is per team: the Clock page and the header show and control the
 * selected team's shift only. A shift open in another team is named here
 * instead of being shown under the selected team's name, and one tap switches
 * to that team (its org first, when it lives in another one).
 */
import { Button, cn, Text } from '@mieweb/ui';
import React from 'react';

import type { Team } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';

export const otherTeamShiftsText = {
  alsoOnTheClock: (teamName: string) => `Also on the clock in ${teamName}`,
  unknownTeam: 'another team',
  switchTo: 'Switch',
  switchToLabel: (teamName: string) => `Switch to ${teamName}`,
};

export const OtherTeamShifts: React.FC<{ className?: string }> = ({ className }) => {
  const { openShifts, selectedTeamId, teams, allTeams, setSelectedOrgId, setSelectedTeamId } =
    useTeam();

  const others = Object.values(openShifts)
    .filter((shift) => shift.teamId !== selectedTeamId)
    .sort((a, b) => a.startTime - b.startTime);
  if (others.length === 0) return null;

  const switchTo = (team: Team) => {
    // A team outside the selected org has to have its org selected first, or
    // the team selection is reset as out of scope.
    if (!teams.some((t) => t.id === team.id) && team.orgId) setSelectedOrgId(team.orgId);
    setSelectedTeamId(team.id);
  };

  return (
    <ul
      className={cn('other-team-shifts flex shrink-0 flex-col items-center gap-1', className)}
      aria-live="polite"
    >
      {others.map((shift) => {
        const team = allTeams.find((t) => t.id === shift.teamId) ?? null;
        const teamName = team?.name ?? otherTeamShiftsText.unknownTeam;
        return (
          <li key={shift.id} className="other-team-shift flex flex-wrap items-center gap-2">
            <Text variant="muted" size="sm">
              {otherTeamShiftsText.alsoOnTheClock(teamName)}
            </Text>
            {team && (
              <Button
                variant="link"
                size="sm"
                onClick={() => switchTo(team)}
                aria-label={otherTeamShiftsText.switchToLabel(teamName)}
              >
                {otherTeamShiftsText.switchTo}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
};
