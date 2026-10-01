/**
 * PulseVault artifact ids and the paths the app builds from them. Every Pulse
 * video URL the app renders comes from here, from an id that has been checked
 * to be a UUID — so it can only ever point at this backend's PulseVault.
 */

/** A PulseVault artifact id: a UUID (the only shape PulseVault accepts). */
export const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The artifact id in a `/pulsevault/artifacts/<id>` URL or path, if any. */
export function pulseArtifactId(url: string | undefined | null): string | null {
  const id = String(url ?? '').match(/\/pulsevault\/artifacts\/([^/?#]+)/)?.[1] ?? null;
  return id && ARTIFACT_ID.test(id) ? id : null;
}

/** The playback path for an artifact id. */
export function artifactPath(id: string): string {
  return `/pulsevault/artifacts/${id}`;
}

/**
 * A video's poster frame, by the video's own id: the server redirects to the
 * thumbnail Pulse uploaded for it, or answers 404 when there isn't one (yet).
 */
export function posterPath(videoId: string): string {
  return `/pulsevault/posters/${videoId}`;
}
