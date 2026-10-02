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
import { useEffect, useMemo, useState } from 'react';
import { fetchTeamMembers } from './api';
import type { TeamMember } from './types';

export interface MentionOption {
  id: string;
  label: string;
}

export interface TeamMentions {
  options: MentionOption[];
  /** Ids of roster members named in `text`, matching SuperChat's own rule; ambiguous first names resolve to no one. */
  detect: (text: string) => string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function useTeamMentions(teamId: string | null | undefined): TeamMentions {
  const [loaded, setLoaded] = useState<{ teamId: string; members: TeamMember[] } | null>(null);

  useEffect(() => {
    if (!teamId) return;
    let cancelled = false;
    fetchTeamMembers(teamId)
      .then((data) => {
        if (!cancelled) setLoaded({ teamId, members: data });
      })
      .catch((err) => {
        console.error('[useTeamMentions] Failed to load team members:', err);
        if (!cancelled) setLoaded({ teamId, members: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  // Keyed by team: the previous team's roster must not mention people into this team's post.
  const members = useMemo(
    () => (teamId && loaded?.teamId === teamId ? loaded.members : []),
    [teamId, loaded],
  );

  return useMemo(() => {
    // Same token as SuperChat's: `@` plus the first word of the name.
    const token = (member: TeamMember) => member.name.split(' ')[0].toLowerCase();
    const tokenCounts = new Map<string, number>();
    for (const member of members) {
      tokenCounts.set(token(member), (tokenCounts.get(token(member)) ?? 0) + 1);
    }
    return {
      options: members.map((member) => ({ id: member.id, label: member.name })),
      detect: (text: string) =>
        members
          // A first name two teammates share can't say which one was picked,
          // and tagging both would notify someone who wasn't mentioned (gap 4.13).
          .filter((member) => tokenCounts.get(token(member)) === 1)
          .filter((member) =>
            new RegExp(`(?<![\\w@])${escapeRegExp(`@${token(member)}`)}(?![\\w])`, 'i').test(text),
          )
          .map((member) => member.id),
    };
  }, [members]);
}
