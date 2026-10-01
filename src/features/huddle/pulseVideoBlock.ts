/**
 * The Pulse video card's wire format in the Huddle inbox.
 *
 * SuperChat renders message markdown, so a Pulse video attachment is written
 * into the message as a fenced GenUI block and the host-registered
 * `pulse_video` widget ({@link ../huddle/PulseVideoCard}) draws it. Kept apart
 * from the widget so that file exports only its component (Vite's Fast Refresh
 * needs that) and the feed can build blocks without loading the card.
 *
 * Post text is written by users, so anyone can type a `genui` block by hand.
 * The payload therefore carries the PulseVault artifact **id**, never a URL:
 * the card builds every URL itself (see pulse-upload/artifact.ts), so a
 * hand-written block can only point at an artifact on this backend.
 */
import type { GenUIWidgetEntry } from '@mieweb/ui/components/SuperChat';
import { z } from 'zod';

import { ARTIFACT_ID, pulseArtifactId } from '../pulse-upload/artifact';

export const PULSE_VIDEO_WIDGET = 'pulse_video';

export const pulseVideoSchema = z.object({
  /** The video artifact; its poster is looked up by this id. */
  video: z.string().regex(ARTIFACT_ID),
  /** What to call it (the Pulse draft's name), for its accessible label. */
  title: z.string().max(200).optional(),
});

export type PulseVideoProps = z.infer<typeof pulseVideoSchema>;

/**
 * The message markdown for a Pulse video, or `null` when the URL isn't a
 * PulseVault artifact (the caller then falls back to a plain link). One line
 * of JSON, so the block holds no blank line — the inbox splits a message's
 * decorations on blank lines (see stripInboxDecorations).
 */
export function pulseVideoMarkdown(videoUrl: string, title?: string): string | null {
  const video = pulseArtifactId(videoUrl);
  if (!video) return null;
  const block = { widget: PULSE_VIDEO_WIDGET, props: { video, ...(title ? { title } : {}) } };
  return '```genui\n' + JSON.stringify(block) + '\n```';
}

/**
 * The `pulse_video` registry entry for SuperChat's GenUI plugin. The card is
 * lazy-loaded, and `schema` rejects any payload that isn't the shape above
 * before it mounts — which is what makes the cast below sound: the registry is
 * typed for `unknown` payloads, but the card only ever receives validated ones.
 */
export const pulseVideoWidget = {
  component: () => import('./PulseVideoCard'),
  schema: pulseVideoSchema,
  prefetch: 'visible',
} as unknown as GenUIWidgetEntry;
