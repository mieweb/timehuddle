/**
 * PulseVault artifact ids and the paths the app builds from them. Every Pulse
 * video URL the app renders comes from here, from an id that has been checked
 * to be a UUID — so it can only ever point at this backend's PulseVault.
 */

/** A PulseVault artifact id: a UUID (the only shape PulseVault accepts). */
export const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The artifact id when a URL or path *is* a `/pulsevault/artifacts/<id>` route,
 * else null. Only the path counts: an external video whose query string
 * mentions such a route (`…/demo.mp4?source=/pulsevault/artifacts/<id>`) stays
 * the external video.
 */
export function pulseArtifactId(url: string | undefined | null): string | null {
  let pathname: string;
  try {
    pathname = new URL(String(url ?? ''), 'http://relative.invalid').pathname;
  } catch {
    return null;
  }
  const id = pathname.match(/^\/pulsevault\/artifacts\/([^/]+)\/?$/)?.[1] ?? null;
  return id && ARTIFACT_ID.test(id) ? id : null;
}

/** What to call a video: its name, else "Video" and the start of its id. */
export function videoLabel(name: string | null | undefined, videoId: string): string {
  return name?.trim() || `Video ${videoId.slice(0, 8)}`;
}

/** The playback path for an artifact id. */
export function artifactPath(id: string): string {
  return `/pulsevault/artifacts/${id}`;
}

/**
 * A video's poster frame, by the video's own id: PulseVault serves the
 * thumbnail Pulse uploaded `relatedTo` it, or answers 404 when there isn't one
 * (yet) — so it shows whichever order Pulse uploaded the two in.
 */
export function posterPath(videoId: string): string {
  return `${artifactPath(videoId)}/poster`;
}
