import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const sendMessageSchema = z.object({
  teamId: z.string().min(1),
  toUserId: z.string().min(1),
  text: z.string().trim().min(1, 'Message text is required').max(5000),
  adminId: z.string().min(1),
  ticketId: z.string().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// ─── Document types ───────────────────────────────────────────────────────────

export interface MessageDoc {
  _id?: string;
  threadId: string;
  teamId: string;
  adminId: string;
  memberId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  senderName: string;
  ticketId?: string;
  createdAt: Date;
}
