import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const createTicketSchema = z.object({
  teamId: z.string().min(1),
  title: z.string().trim().min(1, 'Title is required').max(500, 'Title too long'),
  github: z.string().max(1000).default(''),
  accumulatedTime: z.number().min(0).default(0),
});

export const updateTicketSchema = z.object({
  ticketId: z.string().min(1),
  updates: z.record(z.string(), z.unknown()),
});

export const ticketTimerSchema = z.object({
  ticketId: z.string().min(1),
  now: z.number(),
});

export const batchUpdateStatusSchema = z.object({
  ticketIds: z.array(z.string().min(1)).min(1),
  status: z.enum(['open', 'reviewed', 'deleted', 'closed']),
  teamId: z.string().min(1),
});

export const assignTicketSchema = z.object({
  ticketId: z.string().min(1),
  assignedToUserId: z.string().nullable(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type TicketTimerInput = z.infer<typeof ticketTimerSchema>;
export type BatchUpdateStatusInput = z.infer<typeof batchUpdateStatusSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;

// ─── Document types ───────────────────────────────────────────────────────────

export interface TicketDoc {
  _id?: string;
  teamId: string;
  title: string;
  github: string;
  accumulatedTime: number;
  startTimestamp?: number;
  createdBy: string;
  assignedTo: string | null;
  status?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt?: Date;
}
