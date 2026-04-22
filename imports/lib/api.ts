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
  const hasBody = options.body != null;
  const res = await fetch(`${TIMECORE_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
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

// ─── Ticket API ───────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  teamId: string;
  title: string;
  github: string;
  accumulatedTime: number;
  startTimestamp: number | null;
  status: string;
  createdBy: string;
  assignedTo: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export const ticketApi = {
  getTickets: (teamId: string) =>
    request<{ tickets: Ticket[] }>(`/v1/tickets?teamId=${encodeURIComponent(teamId)}`).then(
      (r) => r.tickets,
    ),

  createTicket: (data: { teamId: string; title: string; github?: string; accumulatedTime?: number }) =>
    request<{ ticket: Ticket }>('/v1/tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.ticket),

  updateTicket: (id: string, updates: { title?: string; github?: string; accumulatedTime?: number; status?: string }) =>
    request<{ ticket: Ticket }>(`/v1/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }).then((r) => r.ticket),

  deleteTicket: (id: string) =>
    request<{ ok: boolean }>(`/v1/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  startTimer: (id: string, now: number) =>
    request<{ ticket: Ticket }>(`/v1/tickets/${encodeURIComponent(id)}/start`, {
      method: 'POST',
      body: JSON.stringify({ now }),
    }).then((r) => r.ticket),

  stopTimer: (id: string, now: number) =>
    request<{ ticket: Ticket }>(`/v1/tickets/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ now }),
    }).then((r) => r.ticket),

  batchUpdateStatus: (data: { ticketIds: string[]; status: string; teamId: string }) =>
    request<{ modified: number }>('/v1/tickets/batch-status', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  assignTicket: (id: string, assignedToUserId: string | null) =>
    request<{ ticket: Ticket }>(`/v1/tickets/${encodeURIComponent(id)}/assign`, {
      method: 'PUT',
      body: JSON.stringify({ assignedToUserId }),
    }).then((r) => r.ticket),
};

// ─── Team API ─────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  description: string | null;
  members: string[];
  admins: string[];
  code: string;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
}

export const teamApi = {
  getTeams: () =>
    request<{ teams: Team[] }>('/v1/teams').then((r) => r.teams),

  ensurePersonal: () =>
    request<{ team: Team }>('/v1/teams/ensure-personal', { method: 'POST' }).then((r) => r.team),

  createTeam: (data: { name: string; description?: string }) =>
    request<{ team: Team }>('/v1/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.team),

  joinTeam: (teamCode: string) =>
    request<{ team: Team }>('/v1/teams/join', {
      method: 'POST',
      body: JSON.stringify({ teamCode }),
    }).then((r) => r.team),

  renameTeam: (id: string, newName: string) =>
    request<{ team: Team }>(`/v1/teams/${encodeURIComponent(id)}/name`, {
      method: 'PUT',
      body: JSON.stringify({ newName }),
    }).then((r) => r.team),

  deleteTeam: (id: string) =>
    request<{ ok: boolean }>(`/v1/teams/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMembers: (id: string) =>
    request<{ members: TeamMember[] }>(`/v1/teams/${encodeURIComponent(id)}/members`).then(
      (r) => r.members,
    ),

  inviteMember: (id: string, email: string) =>
    request<{ ok: boolean }>(`/v1/teams/${encodeURIComponent(id)}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  removeMember: (id: string, userId: string) =>
    request<{ ok: boolean }>(
      `/v1/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),

  setMemberRole: (id: string, userId: string, role: 'admin' | 'member') =>
    request<{ ok: boolean }>(
      `/v1/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/role`,
      { method: 'PUT', body: JSON.stringify({ role }) },
    ),

  setMemberPassword: (id: string, userId: string, newPassword: string) =>
    request<{ ok: boolean }>(
      `/v1/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/password`,
      { method: 'PUT', body: JSON.stringify({ newPassword }) },
    ),
};

// ─── Clock API ────────────────────────────────────────────────────────────────

export interface ClockTicketSession {
  startTimestamp: number;
  endTimestamp: number | null;
}

export interface ClockEventTicket {
  ticketId: string;
  startTimestamp: number | null;
  accumulatedTime: number;
  sessions: ClockTicketSession[];
}

export interface ClockEvent {
  id: string;
  userId: string;
  teamId: string;
  startTimestamp: number;
  accumulatedTime: number;
  tickets: ClockEventTicket[];
  endTime: string | null;
  youtubeShortLink: string | null;
}

export const clockApi = {
  /** Clock in to a team. Returns the new clock event. */
  start: (teamId: string) =>
    request<{ event: ClockEvent }>('/v1/clock/start', {
      method: 'POST',
      body: JSON.stringify({ teamId }),
    }).then((r) => r.event),

  /** Clock out of a team. */
  stop: (teamId: string, youtubeShortLink?: string) =>
    request<{ event: ClockEvent }>('/v1/clock/stop', {
      method: 'POST',
      body: JSON.stringify({ teamId, ...(youtubeShortLink ? { youtubeShortLink } : {}) }),
    }).then((r) => r.event),

  /** Start a ticket timer inside an active clock event. */
  addTicket: (clockEventId: string, ticketId: string, now: number) =>
    request<{ event: ClockEvent }>(`/v1/clock/${encodeURIComponent(clockEventId)}/ticket/start`, {
      method: 'POST',
      body: JSON.stringify({ ticketId, now }),
    }).then((r) => r.event),

  /** Stop a ticket timer inside a clock event. */
  stopTicket: (clockEventId: string, ticketId: string, now: number) =>
    request<{ event: ClockEvent }>(`/v1/clock/${encodeURIComponent(clockEventId)}/ticket/stop`, {
      method: 'POST',
      body: JSON.stringify({ ticketId, now }),
    }).then((r) => r.event),

  /** Get the current user's active clock event (any team), or null. */
  getActive: () =>
    request<{ event: ClockEvent | null }>('/v1/clock/active').then((r) => r.event),

  /** Get all clock events for the current user. */
  getEvents: () =>
    request<{ events: ClockEvent[] }>('/v1/clock/events').then((r) => r.events),

  /** Get timesheet data for a user over a date range. */
  getTimesheet: (userId: string, startDate: string, endDate: string) =>
    request<{
      sessions: ClockEvent[];
      summary: {
        totalSeconds: number;
        totalSessions: number;
        completedSessions: number;
        averageSessionSeconds: number;
        workingDays: number;
      };
    }>(`/v1/clock/timesheet?userId=${encodeURIComponent(userId)}&startDate=${startDate}&endDate=${endDate}`),

  /** Open an SSE connection for live team clock state. Returns an EventSource. */
  openLiveStream: (teamIds: string[]): EventSource =>
    new EventSource(
      `${TIMECORE_BASE_URL}/v1/clock/live?teamIds=${teamIds.map(encodeURIComponent).join(',')}`,
      { withCredentials: true },
    ),
};

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  threadId: string;
  teamId: string;
  adminId: string;
  memberId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  senderName: string;
  ticketId?: string;
  createdAt: string; // ISO
}

export const messageApi = {
  /** Fetch a thread's message history. */
  getThread: (teamId: string, adminId: string, memberId: string) =>
    request<{ messages: Message[] }>(
      `/v1/messages?teamId=${encodeURIComponent(teamId)}&adminId=${encodeURIComponent(adminId)}&memberId=${encodeURIComponent(memberId)}`,
    ).then((r) => r.messages),

  /** Send a message. */
  send: (data: { teamId: string; toUserId: string; text: string; adminId: string; ticketId?: string }) =>
    request<{ message: Message }>('/v1/messages', {
      method: 'POST',
      body: JSON.stringify(data),
    }).then((r) => r.message),

  /** Open an SSE stream for a thread. Returns an EventSource. */
  openStream: (threadId: string): EventSource =>
    new EventSource(
      `${TIMECORE_BASE_URL}/v1/messages/stream?threadId=${encodeURIComponent(threadId)}`,
      { withCredentials: true },
    ),
};

// ─── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO
}

export type TeamInvitePreview = {
  notificationId: string;
  teamId: string;
  teamName: string;
  teamDescription: string;
  inviter: { id: string; name: string; email: string } | null;
  members: { id: string; name: string; email: string }[];
  admins: { id: string; name: string; email: string }[];
  alreadyMember: boolean;
};

export const notificationApi = {
  /** Fetch the user's notification inbox. */
  getInbox: () =>
    request<{ notifications: Notification[] }>('/v1/notifications').then(
      (r) => r.notifications,
    ),

  /** Mark a single notification as read. */
  markOneRead: (id: string) =>
    request<{ ok: boolean }>(`/v1/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    }),

  /** Mark all notifications as read. */
  markAllRead: () =>
    request<{ ok: boolean }>('/v1/notifications/read', { method: 'POST' }),

  /** Bulk-delete notifications by ID. */
  deleteMany: (ids: string[]) =>
    request<{ deletedCount: number }>('/v1/notifications', {
      method: 'DELETE',
      body: JSON.stringify({ ids }),
    }),

  /** Fetch team-invite preview for a notification. */
  getInvitePreview: (id: string) =>
    request<TeamInvitePreview>(
      `/v1/notifications/${encodeURIComponent(id)}/invite-preview`,
    ),

  /** Accept or ignore a team invite. */
  respondToInvite: (id: string, action: 'join' | 'ignore') =>
    request<{ ok: boolean }>(
      `/v1/notifications/${encodeURIComponent(id)}/invite-respond`,
      { method: 'POST', body: JSON.stringify({ action }) },
    ),

  /** Open an SSE stream for new notifications. */
  openStream: (): EventSource =>
    new EventSource(`${TIMECORE_BASE_URL}/v1/notifications/stream`, {
      withCredentials: true,
    }),
};
