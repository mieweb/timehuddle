/**
 * OrgTeamSwitcher — Header control showing and switching the current scope.
 *
 * Renders `Org ▸ Team` so the active scope is legible without opening
 * anything, and opens a single panel holding both lists — a full-width
 * bottom sheet on mobile, a centered dialog on desktop (shared `Modal`
 * primitive), matching the redesign prototype's "Switch organization / team"
 * sheet: an Organization select, a Team list with member counts, and a
 * "+ New team" action.
 *
 * Switching is client-side only: TeamContext persists the selection and
 * re-scopes `teams` to the selected org, auto-picking a valid team.
 */
import { faChevronDown, faClock } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Badge,
  Modal,
  ModalHeader,
  ModalBody,
  Select,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useTeam } from '../lib/TeamContext';
import { Logo } from './Logo';
import { useRouter } from './router';

type OrganizationRole = 'owner' | 'admin' | 'member';

const ROLE_LABEL: Record<OrganizationRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

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
  const { navigate } = useRouter();

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

  const handleSelectTeam = useCallback(
    (teamId: string) => {
      setSelectedTeamId(teamId);
      setOpen(false);
    },
    [setSelectedTeamId],
  );

  const handleNewTeam = useCallback(() => {
    setOpen(false);
    navigate('/app/teams');
  }, [navigate]);

  if (organizations.length === 0 && teams.length === 0) return null;

  const teamLabel = selectedTeam?.name ?? (teamsReady ? 'No team' : '…');
  // The org list arrives on its own schedule (TeamContext retries it once), and
  // there's no ready flag to distinguish "still loading" from "none". Omitting
  // the segment until an org resolves beats claiming "No organization" and
  // being wrong for the first second.
  const scopeLabel = selectedOrg ? `${selectedOrg.name}, ${teamLabel}` : teamLabel;

  return (
    /* Shares the header squeeze with the page title rather than forcing the
       title to absorb all of it — both ellipse instead of one vanishing. */
    <div className="org-team-switcher min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen(true)}
        /* Names the action *and* the current scope — the visible text is
           truncated, so it can't be relied on to announce context. */
        aria-label={`Switch organization and team. Current: ${scopeLabel}`}
        className="flex min-w-0 items-center gap-2"
      >
        <Logo size={28} />
        <span className="min-w-0 text-left">
          <span className="block max-w-[45vw] truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100 md:max-w-[12rem]">
            {teamLabel}
          </span>
          {selectedOrg && (
            <span className="flex min-w-0 items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
              <span className="max-w-[45vw] truncate md:max-w-[12rem]" title={selectedOrg.name}>
                {selectedOrg.name}
              </span>
              <FontAwesomeIcon icon={faChevronDown} className="shrink-0 text-[9px]" />
            </span>
          )}
        </span>
      </button>

      {createPortal(
        <Modal open={open} onOpenChange={setOpen} size="sm" className="org-switcher-modal">
          <ModalHeader>Switch organization / team</ModalHeader>
          <ModalBody className="space-y-1">
          {organizations.length > 0 && (
            <div className="mb-3">
              <Text
                as="span"
                variant="muted"
                size="xs"
                className="mb-1 block font-semibold uppercase tracking-wide"
              >
                Organization
              </Text>
              <Select
                aria-label="Organization"
                value={selectedOrgId ?? ''}
                onValueChange={(id: string) => setSelectedOrgId(id)}
                options={organizations.map((organization) => ({
                  value: organization.id,
                  label: organization.role
                    ? `${organization.name} — ${ROLE_LABEL[organization.role]}`
                    : organization.name,
                }))}
              />
            </div>
          )}

          <Text
            as="span"
            variant="muted"
            size="xs"
            className="mb-1 block font-semibold uppercase tracking-wide"
          >
            Team
          </Text>

          {teamsReady && teams.length === 0 && (
            <div className="px-1 py-2">
              <Text as="span" variant="muted" size="sm">
                No teams in this organization
              </Text>
            </div>
          )}

          <div className="max-h-52 space-y-1 overflow-y-auto">
            {teams.map((team) => {
              const pendingCount = pendingCountByTeam.get(team.id) ?? 0;
              const selected = team.id === selectedTeam?.id;
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => handleSelectTeam(team.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300'
                      : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-200 dark:hover:bg-neutral-800'
                  }`}
                >
                  <span className="min-w-0 truncate" title={team.name}>
                    {team.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {pendingCount > 0 && (
                      <Badge variant="default" size="sm">
                        {pendingCount}
                      </Badge>
                    )}
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {team.members.length} member{team.members.length === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {ownPendingRequests.length > 0 && (
            <div className="mt-3">
              <Text
                as="span"
                variant="muted"
                size="xs"
                className="mb-1 block font-semibold uppercase tracking-wide"
              >
                Awaiting approval
              </Text>
              {ownPendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-neutral-400 opacity-60"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FontAwesomeIcon icon={faClock} className="shrink-0 text-xs" />
                    <span className="truncate">{req.teamCode}</span>
                  </span>
                  <Badge variant="warning" size="sm">
                    Pending
                  </Badge>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleNewTeam}
            className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            + New team
          </button>
        </ModalBody>
      </Modal>,
      document.body,
    )}
    </div>
  );
};
