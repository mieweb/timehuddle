import { z } from 'zod';

// ─── Validation limits ────────────────────────────────────────────────────────

export const NAME_MAX = 50;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Invalid email address');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be fewer than ${PASSWORD_MAX} characters`);

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer`);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
  teamCode: z.string().trim().min(1, 'Team code is required'),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
});
