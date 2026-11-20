/**
 * useTeamMentions — the team roster as @mention candidates for the Huddle
 * message box.
 *
 * SuperChat derives both its suggestion list and the `mentions` it reports on
 * send from the open conversation's participants, which here are only the
 * people who have already posted in that thread. Huddle mentions are
 * team-wide, so the roster supplies the suggestions and `detect` resolves the
 * sent text against it — SuperChat's own ids still come through and are
 * unioned by the caller.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchTeamMembers } from './api';
import { withoutProfileLinks } from './planItems';
import type { TeamMember } from './types';

export interface MentionOption {
  id: string;
  label: string;
  /** Text inserted after `@`; defaults to the label's first word. */
  value?: string;
  /** Shown beside the label in the suggestion list. */
  description?: string;
}

/** `@team` and `@here` (#784): a post addressed to the whole team, or to everyone clocked in to it. */
export type GroupMention = 'team' | 'here';

/** The group mentions as composer suggestions, offered before the roster in a team's Huddle. */
export const GROUP_MENTION_OPTIONS: MentionOption[] = [
  { id: '@team', label: 'team', value: 'team', description: 'Everyone in this team' },
  { id: '@here', label: 'here', value: 'here', description: 'Everyone clocked in now' },
];

/** The group mentions written in `text`, by the same word-boundary rule as a person's. */
export function detectGroupMentions(text: string): GroupMention[] {
  // A teammate's profile link (`[@Team Support](…)`) names that person, not the team.
  const typed = withoutProfileLinks(text);
  return (['team', 'here'] as const).filter((group) =>
    new RegExp(`(?<![\\w@])@${group}(?![\\w])`, 'i').test(typed),
  );
}

export interface TeamMentions {
  options: MentionOption[];
  /**
   * Reads the team's members afresh, sharing a read already in flight. A
   * failed read gives the last roster loaded (empty when there is none).
   */
  loadRoster: () => Promise<TeamMember[]>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Ids of `members` named in `text`, matching SuperChat's own rule; a first name two teammates share resolves to no one. */
export function detectMentions(text: string, members: TeamMember[]): string[] {
  const token = (member: TeamMember) => member.name.split(' ')[0].toLowerCase();
  const tokenCounts = new Map<string, number>();
  for (const member of members) {
    tokenCounts.set(token(member), (tokenCounts.get(token(member)) ?? 0) + 1);
  }
  return members
    .filter((member) => tokenCounts.get(token(member)) === 1)
    .filter((member) =>
      new RegExp(`(?<![\\w@])${escapeRegExp(`@${token(member)}`)}(?![\\w])`, 'i').test(text),
    )
    .map((member) => member.id);
}

export function useTeamMentions(teamId: string | null | undefined): TeamMentions {
  const [loaded, setLoaded] = useState<{ teamId: string; members: TeamMember[] } | null>(null);
  const loadedRef = useRef(loaded);
  const inFlight = useRef<{ teamId: string; request: Promise<TeamMember[]> } | null>(null);
  // A previous team's late response must not replace the current team's roster.
  const currentTeamRef = useRef(teamId);
  currentTeamRef.current = teamId;

  const loadRoster = useCallback((): Promise<TeamMember[]> => {
    if (!teamId) return Promise.resolve([]);
    if (inFlight.current?.teamId === teamId) return inFlight.current.request;
    const request = fetchTeamMembers(teamId)
      .then((members) => {
        if (currentTeamRef.current === teamId) {
          loadedRef.current = { teamId, members };
          setLoaded(loadedRef.current);
        }
        return members;
      })
      .catch((err): TeamMember[] => {
        console.error('[useTeamMentions] Failed to load team members:', err);
        return loadedRef.current?.teamId === teamId ? loadedRef.current.members : [];
      })
      .finally(() => {
        if (inFlight.current?.request === request) inFlight.current = null;
      });
    inFlight.current = { teamId, request };
    return request;
  }, [teamId]);

  // Runs again each time a retained <Activity> shows the page, so teammates
  // who joined meanwhile are offered.
  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  // Keyed by team: the previous team's roster must not mention people into this team's post.
  const members = useMemo(
    () => (teamId && loaded?.teamId === teamId ? loaded.members : []),
    [teamId, loaded],
  );

  return useMemo(
    () => ({
      options: members.map((member) => ({ id: member.id, label: member.name })),
      loadRoster,
    }),
    [members, loadRoster],
  );
}
