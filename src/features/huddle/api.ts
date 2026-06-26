// Huddle feature API helpers
import { teamApi, ticketApi, mediaApi, videoApi, METEOR_BASE_URL } from '@lib/api';
import * as tus from 'tus-js-client';
import type { TeamMember, MediaItem } from './types';

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

/**
 * Upload a media file (photo, video, doc)
 */
export async function uploadMedia(file: File): Promise<MediaItem> {
  let media: MediaItem;

  if (file.type.startsWith('video/')) {
    // Videos go through PulseVault TUS
    const { videoid, uploadToken } = await videoApi.reserveForLibrary();

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: videoApi.uploadEndpoint(),
        retryDelays: [0, 3000, 5000, 10000],
        metadata: {
          filename: file.name,
          filetype: file.type,
          videoid,
        },
        headers: { Authorization: `Bearer ${uploadToken}` },
        onProgress(bytesUploaded, bytesTotal) {
          console.log(
            `[uploadMedia] Video upload: ${Math.round((bytesUploaded / bytesTotal) * 100)}%`,
          );
        },
        onSuccess() {
          resolve();
        },
        onError(err) {
          reject(err);
        },
      });
      upload.start();
    });

    // Build MediaItem shape from the uploaded video
    const videoUrl = `${METEOR_BASE_URL.replace(/\/$/, '')}/v1/video/${videoid}`;
    media = {
      id: videoid,
      userId: '',
      type: 'video' as const,
      mimeType: file.type,
      url: videoUrl,
      videoid,
      filename: file.name,
      size: file.size,
      title: null,
      caption: null,
      altText: null,
      thumbnail: null,
      uploadedAt: new Date().toISOString(),
    };
  } else {
    // Images and documents go through Meteor media upload
    media = await mediaApi.uploadImage(file);
  }

  return media;
}
