/**
 * A Pulse video's captions on playback: the `<track>` a player adds when the
 * video has captions, and nothing at all when it doesn't — a track with no
 * file would still give the player a captions button that does nothing.
 *
 * The server gives a video's captions as `captionsUrl`, the path of the
 * WebVTT artifact Pulse uploaded `relatedTo` it (`/pulsevault/artifacts/<id>`,
 * null for none; meteor-backend/server/pulse-captions-core.js). As with the
 * video itself (artifact.ts), only the artifact id is taken from it and the URL
 * is rebuilt, so a track can only ever point at this backend's PulseVault.
 *
 * The backend is another origin than the page (the web app's own host, a
 * native app's WebView), and a `<track>` from another origin loads only when
 * its `<video>` asks with CORS: a player with a track also sets
 * `crossOrigin="anonymous"` on the video ({@link CAPTIONS_CROSS_ORIGIN}), and
 * one without leaves it unset, as before.
 */
import { resolveMediaUrl } from '@lib/api';
import type { SuperChatMediaAttachment } from '@mieweb/ui/components/SuperChat';
import { artifactPath, pulseArtifactId } from './artifact';

/** User-facing copy, kept together for translation. */
export const CAPTIONS_COPY = {
  /** The track's name, as a player's captions menu lists it. */
  label: 'Captions',
};

/** v1 captions are English: Pulse sends no language with them. */
export const CAPTIONS_LANGUAGE = 'en';

/** What a `<video>` with a captions track sets, so the track may load from the backend. */
export const CAPTIONS_CROSS_ORIGIN = 'anonymous';

/** A captions `<track>`'s props, spread onto it as they are. */
export interface CaptionTrackProps {
  kind: 'captions';
  src: string;
  label: string;
  /** Shown from the start; the player's captions button hides them. */
  default: true;
  srcLang: string;
}

/**
 * The captions track for a video's `captionsUrl`, or null when it has none —
 * null, undefined, empty, or anything that isn't a PulseVault artifact's path
 * or URL — so the player adds no track and no captions button.
 */
export function trackProps(captionsUrl: string | null | undefined): CaptionTrackProps | null {
  const id = captionsUrl ? pulseArtifactId(captionsUrl) : null;
  if (!id) return null;
  return {
    kind: 'captions',
    src: resolveMediaUrl(artifactPath(id)),
    label: CAPTIONS_COPY.label,
    default: true,
    srcLang: CAPTIONS_LANGUAGE,
  };
}

/**
 * A Huddle message's media item's captions, or null: superChatFeed.ts carries
 * a Pulse video's `captionsUrl` along on its media item, since SuperChat's own
 * type has no field for them yet.
 *
 * Read by VideoFeedView's `renderSuperChatMedia`, Huddle's media view's
 * `renderMedia`. Until Huddle.tsx sets it in `mediaFeedProps`, and the server
 * sends `captionsUrl` on a post's video attachments (huddle.js), that view
 * still plays without captions.
 */
export function captionsOfMedia(attachment: SuperChatMediaAttachment): string | null {
  const captionsUrl = (attachment as { captionsUrl?: unknown }).captionsUrl;
  return typeof captionsUrl === 'string' ? captionsUrl : null;
}
