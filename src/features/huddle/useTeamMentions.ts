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

const GROUP_MENTION_IDS = new Set(GROUP_MENTION_OPTIONS.map((option) => option.id));

/** Whether a composer mention id is a group, not a person. */
export function isGroupMentionId(id: string): boolean {
  return GROUP_MENTION_IDS.has(id);
}

/** The group mentions written in `text`, by the same word-boundary rule as a person's. */
export function detectGroupMentions(text: string): GroupMention[] {
  return (['team', 'here'] as const).filter((group) =>
    new RegExp(`(?<![\\w@])@${group}(?![\\w])`, 'i').test(text),
  );
}

export interface TeamMentions {
  options: MentionOption[];
  /** Ids of roster members named in `text`, matching SuperChat's own rule; ambiguous first names resolve to no one. */
  detect: (text: string) => string[];
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

  return useMemo(
    () => ({
      options: members.map((member) => ({ id: member.id, label: member.name })),
      detect: (text: string) => detectMentions(text, members),
    }),
    [members],
  );
}
