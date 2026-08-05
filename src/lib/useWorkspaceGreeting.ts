/**
 * useWorkspaceGreeting — a time-of-day greeting plus a plain-language name for
 * the workspace currently in scope.
 *
 * The org/team switcher in the header already names the current team, but it
 * reads as a control rather than a statement — it's easy to act on the wrong
 * workspace without noticing. Pages use this to say it in words, under their
 * title, where people actually read.
 *
 * The hook owns the facts; each page writes its own sentence, since "you're
 * viewing X" and "you're tracking time in X" are not the same message.
 */
import { useTeam } from './TeamContext';
import { useSession } from './useSession';

export function useWorkspaceGreeting() {
  const { user } = useSession();
  const { teams, selectedTeamId, teamsReady } = useTeam();

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const isPersonalWorkspace = Boolean(selectedTeam?.isPersonal);

  // First name only: the full name is already in the account menu, and a long
  // one would push this line past the title it sits under.
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';

  const hour = new Date().getHours();
  const partOfDay: PartOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const greeting = firstName ? `Good ${partOfDay}, ${firstName}` : `Good ${partOfDay}`;

  const workspaceLabel = isPersonalWorkspace
    ? 'your personal workspace'
    : (selectedTeam?.name ?? '');

  return {
    greeting,
    partOfDay,
    userName: user?.name ?? '',
    userImage: user?.image ?? null,
    workspaceLabel,
    isPersonalWorkspace,
    /**
     * False until there's a real workspace to name. Pages skip the greeting
     * entirely rather than render a half-finished sentence while teams load.
     */
    ready: teamsReady && workspaceLabel !== '',
  };
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening';
