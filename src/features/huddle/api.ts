// Huddle feature API helpers
import { teamApi, ticketApi, mediaApi, videoApi, MEDIA_PATH_PREFIXES } from '@lib/api';
import type { HuddlePost } from '@lib/api';
import * as tus from 'tus-js-client';
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
  };
}

/**
 * Whether this attachment can be previewed inline in the editor.
 *
 * Images only. Markdown has no video syntax, and Kerebron's video node does not
 * survive a markdown round-trip — a dropped clip stays a chip and renders from
 * the post's attachment list instead.
 */
export function isInlineImage(media: MediaItem): boolean {
  return media.type === 'image' || !!media.mimeType?.startsWith('image/');
}

/**
 * A filename as markdown alt text. `[` and `]` would close the alt early and
 * leave the rest of the name as stray document content.
 */
function toAltText(filename: string): string {
  return (filename || 'image').replace(/[[\]]/g, '');
}

/**
 * Append an uploaded image to a markdown document as its own paragraph.
 *
 * The **path** goes in, not the absolute URL the upload handed back: post text
 * outlives the host it was written on, and readers re-base it the same way they
 * re-base attachment URLs (see {@link toMediaPath}).
 */
export function appendImageMarkdown(markdown: string, media: MediaItem): string {
  const snippet = `![${toAltText(media.filename)}](${toMediaPath(media.url)})`;
  const base = markdown.replace(/\s+$/, '');
  return base ? `${base}\n\n${snippet}\n` : `${snippet}\n`;
}

/** A markdown image with empty alt text: `![](/uploads/media/x.png)`. */
const EMPTY_ALT_IMAGE = /!\[\]\(([^()\s]+)\)/g;

/**
 * Put back the alt text Kerebron drops.
 *
 * {@link appendImageMarkdown} writes `![board.png](…)`, but the editor's image
 * node does not carry `alt` through a markdown round-trip — what comes back out
 * of the document is `![](…)`. Persisting that would publish every pasted
 * screenshot with no accessible name at all, so the name is restored from the
 * attachment list on the way out.
 *
 * Only empty alts are filled; alt text the writer typed is never overwritten.
 */
export function restoreImageAltText(markdown: string, attachments: MediaItem[]): string {
  if (!markdown.includes('![](')) return markdown;
  const names = new Map(
    attachments.filter(isInlineImage).map((media) => [toMediaPath(media.url), media.filename]),
  );
  if (names.size === 0) return markdown;
  return markdown.replace(EMPTY_ALT_IMAGE, (whole, url: string) => {
    const name = names.get(toMediaPath(url));
    return name ? `![${toAltText(name)}](${url})` : whole;
  });
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
 * Videos stream to PulseVault over TUS; images and documents go to Meteor's
 * multipart media endpoint. Both report byte progress through `onProgress` so
 * the composer can show one progress bar regardless of which path a file took
 * — a several-second video upload with no feedback is indistinguishable from a
 * broken button.
 */
export async function uploadMedia(file: File, onProgress?: UploadProgress): Promise<MediaItem> {
  if (!file.type.startsWith('video/')) {
    const item = await mediaApi.uploadImage(file, onProgress);
    onProgress?.(1);
    // `filename` off the wire is the storage name the backend generated
    // (`<userId>-<hex>.png`), which is what the composer chip and the post
    // attachment ended up showing. `title` is the name the user picked, so
    // prefer it — rebased here, at the one boundary every caller goes through.
    return { ...item, filename: item.title ?? item.filename };
  }

  // Videos go through PulseVault TUS
  const { videoid, uploadToken } = await videoApi.reserveForLibrary();

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: videoApi.uploadRetryDelays,
      onShouldRetry: videoApi.shouldRetryUpload,
      metadata: {
        filename: file.name,
        filetype: file.type,
        videoid,
      },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress(bytesUploaded, bytesTotal) {
        if (bytesTotal > 0) onProgress?.(bytesUploaded / bytesTotal);
      },
      onSuccess() {
        onProgress?.(1);
        resolve();
      },
      onError(err) {
        reject(err);
      },
    });
    upload.start();
  });

  return {
    id: videoid,
    type: 'video',
    size: file.size,
    mimeType: file.type,
    // Path only — the reader binds it to the current backend origin.
    url: `/pulsevault/artifacts/${videoid}`,
    filename: file.name,
  };
}
