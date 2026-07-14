/**
 * OrgTeamSwitcher — Header control showing and switching the current scope.
 *
 * Renders `Org ▸ Team` so the active scope is legible without opening
 * anything, and opens a single panel holding both lists.
 *
 * Switching is client-side only: TeamContext persists the selection and
 * re-scopes `teams` to the selected org, auto-picking a valid team.
 */
import { faCheck, faChevronDown, faChevronRight, faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Dropdown, DropdownItem, DropdownLabel, DropdownSeparator, Text } from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';

import { useTeam } from '../lib/TeamContext';

type OrganizationRole = 'owner' | 'admin' | 'member';

const ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

/**
 * DropdownItem wraps its children in its own `<span>` that defaults to
 * `min-width: auto`, so a long name would push the row past the menu edge
 * instead of ellipsing. Let that wrapper shrink.
 */
const ROW = 'min-w-0 [&>span]:min-w-0';

/** Check icon that reserves its space so rows don't shift when selection moves. */
const SelectedCheck: React.FC<{ selected: boolean }> = ({ selected }) => (
  <FontAwesomeIcon
    icon={faCheck}
    className={`shrink-0 text-xs text-primary-600 transition-opacity ${
      selected ? 'opacity-100' : 'opacity-0'
    }`}
  />
);

export const OrgTeamSwitcher: React.FC = () => {
  const {
    organizations,
    selectedOrgId,
    setSelectedOrgId,
    teams,
    selectedTeam,
    setSelectedTeamId,
    teamsReady,
    pendingRequests,
  } = useTeam();

  const [open, setOpen] = useState(false);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId],
  );

  // Requests for teams the user already belongs to are incoming ones they
  // administer — surfaced as a count on the team row. Anything else is the
  // user's own join request, still awaiting approval.
  const ownPendingRequests = useMemo(
    () => pendingRequests.filter((req) => !teams.some((team) => team.id === req.teamId)),
    [pendingRequests, teams],
  );

  const pendingCountByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const req of pendingRequests) {
      counts.set(req.teamId, (counts.get(req.teamId) ?? 0) + 1);
    }
    return counts;
  }, [pendingRequests]);

  // Selecting an org leaves the panel open so the re-scoped team list below
  // can be picked from; selecting a team completes the task and closes it.
  const handleSelectOrg = useCallback(
    (organizationId: string) => setSelectedOrgId(organizationId),
    [setSelectedOrgId],
  );

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      setOpen(false);
    },
    [setSelectedTeamId],
  );

  if (organizations.length === 0 && teams.length === 0) return null;

  const teamLabel = selectedTeam?.name ?? (teamsReady ? 'No team' : '…');
  // The org list arrives on its own schedule (TeamContext retries it once), and
  // there's no ready flag to distinguish "still loading" from "none". Omitting
  // the segment until an org resolves beats claiming "No organization" and
  // being wrong for the first second.
  const scopeLabel = selectedOrg ? `${selectedOrg.name}, ${teamLabel}` : teamLabel;

  return (
    /* Shares the header squeeze with the page title rather than forcing the
       title to absorb all of it — both ellipse instead of one vanishing.
       Dropdown renders its own `relative inline-flex` container that defaults
       to `min-width: auto`; without relaxing it the trigger refuses to shrink
       and spills over the header's right-hand controls. */
    <div className="org-team-switcher min-w-0 shrink [&>div]:min-w-0 [&>div]:max-w-full">
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        placement="bottom-start"
        width={260}
        trigger={
          <button
            type="button"
            /* Names the action *and* the current scope — the visible text is
               truncated, so it can't be relied on to announce context. */
            aria-label={`Switch organization and team. Current: ${scopeLabel}`}
            className="flex min-w-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {selectedOrg && (
              /* Below 360px (original iPhone SE) there isn't room for both
                 segments plus a legible title, so the org yields; it is still
                 the first row of the panel. Every current phone is >= 360. */
              <span className="hidden min-w-0 items-center gap-1.5 min-[360px]:flex">
                <span
                  className="min-w-0 max-w-[4.5rem] truncate md:max-w-[9rem]"
                  title={selectedOrg.name}
                >
                  {selectedOrg.name}
                </span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className="shrink-0 text-[9px] text-neutral-400"
                />
              </span>
            )}
            <span className="min-w-0 max-w-[4.5rem] truncate md:max-w-[9rem]" title={teamLabel}>
              {teamLabel}
            </span>
            <FontAwesomeIcon
              icon={faChevronDown}
              className="shrink-0 text-[10px] text-neutral-400"
            />
          </button>
        }
      >
        {organizations.length > 0 && (
          <>
            <DropdownLabel>Organization</DropdownLabel>
            {organizations.map((organization) => (
              <DropdownItem
                key={organization.id}
                className={ROW}
                onClick={() => handleSelectOrg(organization.id)}
                aria-current={organization.id === selectedOrgId ? 'true' : undefined}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <SelectedCheck selected={organization.id === selectedOrgId} />
                    <span className="truncate font-normal" title={organization.name}>
                      {organization.name}
                    </span>
                  </span>
                  {organization.role && (
                    <Badge variant="secondary" size="sm" className="shrink-0">
                      {ROLE_LABEL[organization.role]}
                    </Badge>
                  )}
                </span>
              </DropdownItem>
            ))}
            <DropdownSeparator />
          </>
        )}

        <DropdownLabel>{selectedOrg ? `Teams in ${selectedOrg.name}` : 'Teams'}</DropdownLabel>

        {teamsReady && teams.length === 0 && (
          <div className="px-3 py-2">
            <Text as="span" variant="muted" size="sm">
              No teams in this organization
            </Text>
          </div>
        )}

        {teams.map((team) => {
          const pendingCount = pendingCountByTeam.get(team.id) ?? 0;
          return (
            <DropdownItem
              key={team.id}
              className={ROW}
              onClick={() => handleSelectTeam(team.id)}
              aria-current={team.id === selectedTeam?.id ? 'true' : undefined}
            >
              <span className="flex w-full min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <SelectedCheck selected={team.id === selectedTeam?.id} />
                  <span className="truncate font-normal" title={team.name}>
                    {team.name}
                  </span>
                </span>
                {pendingCount > 0 && (
                  <Badge variant="default" size="sm" className="shrink-0">
                    {pendingCount}
                  </Badge>
                )}
              </span>
            </DropdownItem>
          );
        })}

        {ownPendingRequests.length > 0 && (
          <>
            <DropdownSeparator />
            <DropdownLabel>Awaiting approval</DropdownLabel>
            {ownPendingRequests.map((req) => (
              <DropdownItem
                key={req.id}
                disabled
                className={`cursor-not-allowed opacity-60 ${ROW}`}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FontAwesomeIcon icon={faClock} className="shrink-0 text-xs text-neutral-400" />
                    <span className="truncate font-normal">{req.teamCode}</span>
                  </span>
                  <Badge variant="warning" size="sm" className="shrink-0">
                    Pending
                  </Badge>
                </span>
              </DropdownItem>
            ))}
          </>
        )}
      </Dropdown>
    </div>
  );
};
