import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const teamNameSchema = z
  .string()
  .trim()
  .min(1, 'Team name is required')
  .max(100, 'Team name must be 100 characters or less');

export const teamCodeSchema = z
  .string()
  .trim()
  .min(1, 'Team code is required')
  .max(20, 'Team code must be 20 characters or less');

export const createTeamSchema = z.object({
  name: teamNameSchema,
});

export const joinTeamSchema = z.object({
  teamCode: teamCodeSchema,
});

export const updateTeamNameSchema = z.object({
  teamId: z.string().min(1),
  newName: teamNameSchema,
});

export const teamMemberActionSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string().min(1),
});

export const inviteTeamMemberSchema = z.object({
  teamId: z.string().min(1),
  email: z.string().email('Invalid email address'),
});

export const setTeamMemberPasswordSchema = z.object({
  teamId: z.string().min(1),
  userId: z.string().min(1),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type JoinTeamInput = z.infer<typeof joinTeamSchema>;
export type UpdateTeamNameInput = z.infer<typeof updateTeamNameSchema>;
export type TeamMemberActionInput = z.infer<typeof teamMemberActionSchema>;
export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;
export type SetTeamMemberPasswordInput = z.infer<typeof setTeamMemberPasswordSchema>;

// ─── Document types ───────────────────────────────────────────────────────────

export interface TeamDoc {
  _id?: string;
  name: string;
  members: string[];
  admins: string[];
  code: string;
  isPersonal?: boolean;
  createdAt: Date;
}

export interface NotificationDoc {
  _id?: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}
