// Huddle feature types
import type { Ticket as ApiTicket, TeamMember as ApiTeamMember } from '@lib/api';

export type AvatarColor = 'indigo' | 'teal' | 'coral' | 'amber' | 'pink' | 'green';

// Re-export API types for convenience
export type Ticket = ApiTicket;
export type TeamMember = ApiTeamMember;

export interface MediaItem {
  id: string;
  url: string;
  filename: string;
  type: string;
  size: number;
  mimeType?: string;
}

export interface MentionNode {
  type: 'mention';
  userId: string;
  text: string;
}
