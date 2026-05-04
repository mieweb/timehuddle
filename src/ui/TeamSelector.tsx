import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dropdown, DropdownItem, Text } from '@mieweb/ui';
import React from 'react';

import { useTeam } from '../lib/TeamContext';

export const TeamSelector: React.FC = () => {
  const { teams, selectedTeam, setSelectedTeamId, teamsReady } = useTeam();

  if (!teamsReady || teams.length === 0) return null;

  return (
    <Dropdown
      trigger={
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          aria-label="Switch team"
        >
          <Text size="sm" weight="medium" className="max-w-[120px] truncate">
            {selectedTeam?.name ?? 'Select team'}
          </Text>
          <FontAwesomeIcon icon={faChevronDown} className="text-[10px] text-neutral-400" />
        </button>
      }
      placement="bottom-end"
      width={200}
    >
      {teams.map((team) => (
        <DropdownItem key={team.id} onClick={() => setSelectedTeamId(team.id)}>
          {team.id === selectedTeam?.id ? `✓ ${team.name}` : team.name}
        </DropdownItem>
      ))}
    </Dropdown>
  );
};
