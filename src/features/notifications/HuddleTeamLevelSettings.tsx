/**
 * "Huddle, per team" (#784): each of the user's teams with its Huddle level.
 * The same choice as the bell in a Huddle conversation. Rendered inside a
 * Settings card; personal teams are left out, since nobody else posts there.
 */
import { Button, ButtonGroup, Text } from '@mieweb/ui';
import React from 'react';

import { useTeam } from '../../lib/TeamContext';
import { HUDDLE_TEAM_LEVELS, NOTIFICATION_STRINGS as S } from './notificationCopy';
import { PrefsStatus } from './PrefsStatus';
import { useNotificationPrefs } from './useNotificationPrefs';

export const HuddleTeamLevelSettings: React.FC = () => {
  const { allTeams } = useTeam();
  const { prefs, error, teamLevel, setTeamLevel } = useNotificationPrefs();
  const teams = allTeams.filter((team) => !team.isPersonal);

  return (
    <div className="huddle-team-level-settings">
      <PrefsStatus loading={!prefs} error={error} />
      {prefs && teams.length === 0 && (
        <Text variant="muted" size="sm" className="px-5 py-3.5">
          {S.teamsEmpty}
        </Text>
      )}
      {prefs && (
        <ul className="huddle-team-level-list divide-y divide-neutral-100 dark:divide-neutral-800">
          {teams.map((team) => (
            <li
              key={team.id}
              className="huddle-team-level-row flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
            >
              <Text size="sm" weight="medium" className="min-w-0 truncate">
                {team.name}
              </Text>
              <ButtonGroup role="radiogroup" aria-label={S.teamLevelLabel(team.name)}>
                {HUDDLE_TEAM_LEVELS.map(({ level, label }) => {
                  const selected = teamLevel(team.id) === level;
                  return (
                    <Button
                      key={level}
                      size="sm"
                      variant={selected ? 'primary' : 'outline'}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => !selected && setTeamLevel(team.id, level)}
                    >
                      {label}
                    </Button>
                  );
                })}
              </ButtonGroup>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
