// Huddle feature API helpers
import { teamApi, ticketApi, mediaApi } from '@lib/api';
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
  const item = await mediaApi.uploadImage(file);
  return item;
}
