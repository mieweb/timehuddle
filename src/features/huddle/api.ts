// Huddle feature API helpers
import { teamApi, ticketApi, mediaApi, MEDIA_PATH_PREFIXES } from '@lib/api';
import type { ComposerAttachment } from '@mieweb/ui/components/SuperChat';
import type { HuddlePost } from '@lib/api';
import { artifactPath, pulseArtifactId } from '../pulse-upload/artifact';
import { isVideoFile, uploadVideoTo } from '../pulse-upload/videoFile';
import type { TeamMember, MediaItem } from './types';

export type PostAttachment = HuddlePost['attachments'][number];

/**
 * Strip the origin from a backend media URL so posts persist the path only.
 *
 * The host a file was uploaded through is not a property of the file: dev is
 * served from a LAN IP that changes with the DHCP lease, and deployments move
 * between hostnames. Persisting the origin freezes a post's media to whatever
 * address the backend happened to answer on that day. Readers re-attach the
 * current origin via `resolveMediaUrl`.
 *
 * Only backend-owned paths ({@link MEDIA_PATH_PREFIXES}) are rewritten —
 * user-entered links (e.g. a Loom URL copied from a ticket attachment) are
 * left absolute so they still resolve once the origin is stripped away.
 */
export function toMediaPath(url: string): string {
  try {
    const parsed = new URL(url, 'http://placeholder.invalid');
    if (!MEDIA_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p))) return url;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Convert a composer MediaItem into the attachment shape stored on a post.
 */
export function toPostAttachment(media: MediaItem): PostAttachment {
  let type: PostAttachment['type'];
  if (media.type === 'image') {
    type = 'image';
  } else if (media.type === 'video') {
    type = 'video';
  } else if (media.type === 'document') {
    type = 'file';
  } else {
    // Fallback based on mimeType
    type = media.mimeType?.startsWith('image/') ? 'image' : 'file';
  }

  return {
    mediaId: media.id,
    type,
    url: toMediaPath(media.url),
    filename: media.filename,
    ...(typeof media.size === 'number' ? { size: media.size } : {}),
    ...(media.width && media.height ? { width: media.width, height: media.height } : {}),
  };
}

/**
 * The media item a file attached in SuperChat's chat input uploaded to: the
 * composer uploads each one as it's attached (`composerProps.uploadAttachment`
 * runs uploadMedia) and waits for the rest before sending, so it's there.
 */
export function uploadedMedia(attachment: ComposerAttachment): MediaItem {
  if (!attachment.result) throw new Error(`${attachment.name} didn't upload. Attach it again.`);
  return attachment.result as MediaItem;
}

/**
 * Fetch team members for mention autocomplete
 */
export async function fetchTeamMembers(teamId: string): Promise<TeamMember[]> {
  const members = await teamApi.getMembers(teamId);
  return members;
}

/**
 * Fetch tickets for ticket picker
 */
export async function fetchTeamTickets(teamId: string) {
  if (!teamId) {
    throw new Error('Team ID is required to fetch tickets');
  }
  return ticketApi.getTickets(teamId);
}

/** Fraction (0–1) of an in-flight upload, reported as bytes go out. */
export type UploadProgress = (fraction: number) => void;

/**
 * Upload a media file (photo, video, doc).
 *
 * Videos stream to PulseVault over TUS and resolve once the server has
 * conformed them, so a post never carries a video that won't play; images and
 * documents go to Meteor's multipart media endpoint. Both report byte progress
 * through `onProgress` so the composer can show one progress bar regardless of
 * which path a file took.
 */
/**
 * An image's size in pixels, read before upload so its tile in the thread
 * keeps its space before the picture loads; nothing for anything else (a
 * document, or an image the browser can't decode).
 */
async function imageSize(
  file: File,
): Promise<{ width: number; height: number } | Record<string, never>> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return {};
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return {};
  }
}

/**
 * Upload a file a composer attached: a photo or document to the media
 * library, a video to PulseVault (resolving once it's filed). Rejects with an
 * AbortError once `signal` aborts (uploadCancelled).
 */
export async function uploadMedia(
  file: File,
  onProgress?: UploadProgress,
  signal?: AbortSignal,
): Promise<MediaItem> {
  if (!isVideoFile(file)) {
    const [item, size] = await Promise.all([
      mediaApi.uploadImage(file, onProgress, signal),
      imageSize(file),
    ]);
    // Cancelled once its bytes were in: the server made it, so take it back.
    if (signal?.aborted) {
      void mediaApi.discardUpload({ mediaId: item.id }).catch(() => {});
      throw new DOMException('Upload cancelled', 'AbortError');
    }
    onProgress?.(1);
    // `filename` off the wire is the storage name the backend generated
    // (`<userId>-<hex>.png`), which is what the composer chip and the post
    // attachment ended up showing. `title` is the name the user picked, so
    // prefer it — rebased here, at the one boundary every caller goes through.
    return { ...item, filename: item.title ?? item.filename, ...size };
  }

  // The post's own: its media item stays out of the library, so deleting the
  // post (or cancelling a scheduled one) doesn't put it there.
  const videoid = await uploadVideoTo({ kind: 'post' }, file, onProgress, signal);

  return {
    id: videoid,
    type: 'video',
    size: file.size,
    mimeType: 'video/mp4',
    // Path only — the reader binds it to the current backend origin.
    url: artifactPath(videoid),
    filename: file.name,
  };
}

/**
 * Take back an upload (uploadMedia) the user removed before sending: a video
 * by its id (the PulseVault id), a photo or document by its media item.
 */
export function discardMedia(item: MediaItem): Promise<void> {
  return item.type === 'video' && pulseArtifactId(item.url)
    ? mediaApi.discardUpload({ videoid: item.id })
    : mediaApi.discardUpload({ mediaId: item.id });
}
