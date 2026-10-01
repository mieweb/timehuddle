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
 * The payload therefore carries PulseVault artifact **ids**, never URLs: the
 * card builds every URL itself, so a hand-written block can only point at an
 * artifact on this backend's own `/pulsevault/artifacts` route.
 */
import type { GenUIWidgetEntry } from '@mieweb/ui/components/SuperChat';
import { z } from 'zod';

export const PULSE_VIDEO_WIDGET = 'pulse_video';

/** A PulseVault artifact id: a UUID (the only shape PulseVault accepts). */
const artifactId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const pulseVideoSchema = z.object({
  /** The video artifact. */
  video: artifactId,
  /** Its poster frame (Pulse's uploaded thumbnail), when there is one. */
  poster: artifactId.optional(),
});

export type PulseVideoProps = z.infer<typeof pulseVideoSchema>;

/** The artifact id in a `/pulsevault/artifacts/<id>` URL or path, if any. */
export function pulseArtifactId(url: string | undefined | null): string | null {
  const id = String(url ?? '').match(/\/pulsevault\/artifacts\/([^/?#]+)/)?.[1] ?? null;
  return id && artifactId.safeParse(id).success ? id : null;
}

/** The playback / poster path for an artifact id. */
export function artifactPath(id: string): string {
  return `/pulsevault/artifacts/${id}`;
}

/**
 * The message markdown for a Pulse video, or `null` when the URL isn't a
 * PulseVault artifact (the caller then falls back to a plain link). One line
 * of JSON, so the block holds no blank line — the inbox splits a message's
 * decorations on blank lines (see stripInboxDecorations).
 */
export function pulseVideoMarkdown(videoUrl: string, thumbnailUrl?: string): string | null {
  const video = pulseArtifactId(videoUrl);
  if (!video) return null;
  const poster = pulseArtifactId(thumbnailUrl) ?? undefined;
  const block = { widget: PULSE_VIDEO_WIDGET, props: { video, ...(poster ? { poster } : {}) } };
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
