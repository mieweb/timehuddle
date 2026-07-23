/**
 * PlanComposer — the Huddle composer embedded in the clock-page plan-first
 * gate, so users can satisfy the gate without navigating to the Huddle tab.
 * Plan mode creates today's post; wrap-up mode appends a wrap-up to it and
 * stamps wrapUpAt.
 */
import { Text } from '@mieweb/ui';
import React from 'react';

import { huddleApi, type HuddlePost } from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { toDateString } from '../../lib/timeUtils';
import { useSession } from '../../lib/useSession';
import { HuddleComposer } from '../huddle/HuddleComposer';
import { toPostAttachment } from '../huddle/api';
import { getUserColor, getUserInitials } from '../huddle/avatar';
import type { ComposerContent } from '../huddle/types';

interface PlanComposerProps {
  teamId: string;
  /** Today's post — present in wrap-up mode, null in plan mode. */
  todayPost: HuddlePost | null;
  mode: 'plan' | 'wrapup';
  /** Shown when the gated team differs from the selected team. */
  teamName?: string;
  /** Secondary link to the full Huddle feed. */
  onGoToHuddle: () => void;
}

export const PlanComposer: React.FC<PlanComposerProps> = ({
  teamId,
  todayPost,
  mode,
  teamName,
  onGoToHuddle,
}) => {
  const { user } = useSession();
  const isPlan = mode === 'plan';

  async function handlePost(content: ComposerContent) {
    try {
      if (isPlan) {
        await getDdpClient().call('huddle.createPost', {
          teamId,
          content: { text: content.text, mentions: content.mentions.map((m) => m.userId) },
          ticketId: content.ticketId,
          attachments: content.attachments.map(toPostAttachment),
          postDate: toDateString(new Date()),
        });
      } else if (todayPost) {
        await huddleApi.updatePost(
          todayPost.id,
          {
            text: `${todayPost.content.text}\n\n**Wrap-up:** ${content.text}`,
            mentions: [
              ...new Set([...todayPost.content.mentions, ...content.mentions.map((m) => m.userId)]),
            ],
          },
          { wrapUp: true },
        );
      }
      // useDailyPost listens for this and refetches, flipping the clock gates.
      window.dispatchEvent(new CustomEvent('huddle:refetch'));
    } catch (error) {
      console.error('[PlanComposer] Failed to post:', error);
      alert('Failed to post. Please try again.');
    }
  }

  return (
    <div className="clock-plan-composer flex flex-col gap-2">
      <Text variant="warning" size="sm">
        {isPlan
          ? `Write today’s plan${teamName ? ` for “${teamName}”` : ''} before clocking in.`
          : `Add a wrap-up to today’s post${teamName ? ` in “${teamName}”` : ''} before clocking out.`}{' '}
        <button
          type="button"
          onClick={onGoToHuddle}
          className="text-blue-500 hover:underline"
          aria-label="Open the Huddle feed"
        >
          Open Huddle
        </button>
      </Text>
      <HuddleComposer
        onPost={handlePost}
        userInitials={user ? getUserInitials(user.name) : 'U'}
        userColor={user ? getUserColor(user.id) : 'indigo'}
      />
    </div>
  );
};
