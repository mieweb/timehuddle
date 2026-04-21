/**
 * Typed fetch wrappers for the timecore backend.
 *
 * Base URL is read from Meteor.settings.public.timecoreUrl (set in settings.json),
 * falling back to localhost:4000 for local development.
 */
import { Meteor } from 'meteor/meteor';

// ─── Config ───────────────────────────────────────────────────────────────────

export const TIMECORE_BASE_URL: string =
  (Meteor.settings?.public as Record<string, string> | undefined)?.timecoreUrl ??
  'http://localhost:4000';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimecoreUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  image?: string | null;
}

export interface PublicUser {
  id: string;
  name: string;
  image: string | null;
  bio: string;
  website: string;
}

// ─── Base request ─────────────────────────────────────────────────────────────

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${TIMECORE_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      (body.message as string | undefined) ??
      (body.error as string | undefined) ??
      `HTTP ${res.status}`,
    );
  }

  return res.json() as Promise<T>;
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  /** Sign in — sets better-auth session cookie on success. */
  signIn: (email: string, password: string) =>
    request('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  /** Sign up — creates account. Does NOT auto-create session; call signIn after. */
  signUp: (email: string, password: string, name: string) =>
    request('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),

  /** Sign out — clears better-auth session cookie. */
  signOut: () =>
    request('/api/auth/sign-out', { method: 'POST' }),

  /**
   * Request a password-reset email.
   * @param redirectTo - URL to include in the email link as the callbackURL.
   *                     better-auth will append ?token=TOKEN before redirecting.
   */
  requestPasswordReset: (email: string, redirectTo: string) =>
    request('/api/auth/request-password-reset', {
      method: 'POST',
      body: JSON.stringify({ email, redirectTo }),
    }),

  /**
   * Reset password using the token from the reset-password email.
   * @param token - from the ?token= query param on the reset-password landing page.
   */
  resetPassword: (token: string, newPassword: string) =>
    request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),

  /**
   * Fetch the currently authenticated user.
   * Returns null on 401 (not authenticated), throws on other errors.
   */
  getMe: async (): Promise<{ user: TimecoreUser } | null> => {
    try {
      return await request<{ user: TimecoreUser }>('/v1/me');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('HTTP 401')) return null;
      throw err;
    }
  },
};

// ─── User API ─────────────────────────────────────────────────────────────────

export const userApi = {
  /** Get a single user's public profile by ID. */
  getUser: (id: string) =>
    request<{ user: PublicUser }>(`/v1/users/${encodeURIComponent(id)}`).then((r) => r.user),

  /** Batch-fetch public profiles by ID list (server caps at 200). */
  getUsers: (ids: string[]) =>
    request<{ users: PublicUser[] }>(`/v1/users?ids=${ids.map(encodeURIComponent).join(',')}`).then(
      (r) => r.users,
    ),

  /** Update the current user's profile fields. */
  updateProfile: (data: { name?: string; image?: string | null; bio?: string; website?: string }) =>
    request<{ user: PublicUser }>('/v1/me/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }).then((r) => r.user),
};
