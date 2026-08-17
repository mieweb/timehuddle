// Huddle feature API helpers
import { teamApi, ticketApi, mediaApi, videoApi } from '@lib/api';
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
 */
function toMediaPath(url: string): string {
  try {
    const parsed = new URL(url, 'http://placeholder.invalid');
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
  console.log('[fetchTeamTickets] Called with teamId:', teamId, 'type:', typeof teamId);

  if (!teamId) {
    console.error('[fetchTeamTickets] No teamId provided');
    throw new Error('Team ID is required to fetch tickets');
  }

  try {
    console.log('[fetchTeamTickets] Calling ticketApi.getTickets...');
    const tickets = await ticketApi.getTickets(teamId);
    console.log('[fetchTeamTickets] Success, received tickets:', tickets);
    return tickets;
  } catch (error) {
    console.error('[fetchTeamTickets] API call failed:', error);
    throw error;
  }
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
    return item;
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
