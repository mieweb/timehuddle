import { faCheck, faChevronDown, faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Dropdown, DropdownItem, Text } from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';

import { useTeam } from '../lib/TeamContext';

export const TeamSelector: React.FC = () => {
  const { teams, pendingRequests, selectedTeam, setSelectedTeamId, teamsReady } = useTeam();

  // Map of teamId → count of pending requests for that team
  const pendingCountByTeam = useMemo(() => {
    const map = new Map<string, number>();
    for (const req of pendingRequests) {
      map.set(req.teamId, (map.get(req.teamId) || 0) + 1);
    }
    return map;
  }, [pendingRequests]);
  const [open, setOpen] = useState(false);

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      setOpen(false);
    },
    [setSelectedTeamId],
  );

  if (!teamsReady || teams.length === 0) return null;

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
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
      {/* User's pending join requests (not yet approved) */}
      {pendingRequests.length > 0 && (
        <>
          {pendingRequests.map((req) => (
            <DropdownItem
              key={`pending-${req.id}`}
              disabled
              className="opacity-60 cursor-not-allowed"
            >
              <span className="flex items-center justify-between gap-2 w-full">
                <span className="flex items-center gap-2">
                  <FontAwesomeIcon icon={faClock} className="text-xs text-neutral-400" />
                  <span className="text-sm">{req.teamCode}</span>
                </span>
                <Badge variant="warning" size="sm">
                  Pending
                </Badge>
              </span>
            </DropdownItem>
          ))}
          <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
        </>
      )}

      {/* Actual teams user belongs to */}
      {teams.map((team) => {
        const pendingCount = pendingCountByTeam.get(team.id);
        return (
          <DropdownItem key={team.id} onClick={() => handleSelectTeam(team.id)}>
            <span className="flex items-center justify-between gap-2 w-full">
              <span className="flex items-center gap-2">
                <FontAwesomeIcon
                  icon={faCheck}
                  className={`text-xs text-blue-600 transition-opacity ${
                    team.id === selectedTeam?.id ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                <span>{team.name}</span>
              </span>
              {pendingCount && pendingCount > 0 ? (
                <Badge variant="default" size="sm">
                  {pendingCount}
                </Badge>
              ) : null}
            </span>
          </DropdownItem>
        );
      })}
    </Dropdown>
  );
};
