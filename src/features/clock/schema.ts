import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const clockEventStartSchema = z.object({
  teamId: z.string().min(1),
});

export const clockEventStopSchema = z.object({
  teamId: z.string().min(1),
  youtubeShortLink: z.string().optional(),
});

export const clockEventTicketSchema = z.object({
  clockEventId: z.string().min(1),
  ticketId: z.string().min(1),
  now: z.number(),
});

export const updateClockEventTimesSchema = z.object({
  clockEventId: z.string().min(1),
  startTimestamp: z.number().optional(),
  endTimestamp: z.number().nullable().optional(),
});

export const updateYoutubeLinkSchema = z.object({
  clockEventId: z.string().min(1),
  youtubeShortLink: z.string(),
});

export const timesheetQuerySchema = z.object({
  userId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

export type ClockEventStartInput = z.infer<typeof clockEventStartSchema>;
export type ClockEventStopInput = z.infer<typeof clockEventStopSchema>;
export type ClockEventTicketInput = z.infer<typeof clockEventTicketSchema>;
export type UpdateClockEventTimesInput = z.infer<typeof updateClockEventTimesSchema>;
export type TimesheetQueryInput = z.infer<typeof timesheetQuerySchema>;

// ─── Document types ───────────────────────────────────────────────────────────

export interface TicketSession {
  startTimestamp: number;
  endTimestamp: number | null;
}

export interface ClockEventTicket {
  ticketId: string;
  startTimestamp?: number;
  accumulatedTime: number;
  sessions?: TicketSession[];
}

export interface ClockEventDoc {
  _id?: string;
  userId: string;
  teamId: string;
  startTimestamp: number;
  accumulatedTime: number;
  tickets: ClockEventTicket[];
  endTime: Date | null;
  youtubeShortLink?: string;
}

export interface SessionDoc {
  _id?: string;
  userId: string;
  teamId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}
