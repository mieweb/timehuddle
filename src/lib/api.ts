/**
 * Typed fetch wrappers for the timecore backend.
 *
 * Base URL is read from the VITE_TIMECORE_URL env var (set in .env),
 * falling back to localhost:4000 for local development.
 */
// autoReconnectWs removed - no longer needed after migrating tickets to wormhole
import { getDdpClient } from './ddp.js';
import { toDateString } from './timeUtils';

// ─── Config ───────────────────────────────────────────────────────────────────

export const TIMECORE_BASE_URL: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_TIMECORE_URL) ||
  'http://localhost:4000';

const _WS_BASE_URL = TIMECORE_BASE_URL.replace(/^http/, 'ws');

/** Meteor backend (wormhole REST + DDP) base URL — direct URL for assets, OAuth, etc. */
export const METEOR_BASE_URL: string =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_TIMECORE_URL) ||
  'http://localhost:3100';

/**
 * Base URL for REST API fetch calls (wormhole, avatar, media, etc.).
 *
 * - Capacitor native: no Vite proxy, must use absolute VITE_TIMECORE_URL.
 * - Web with explicit VITE_TIMECORE_URL (Docker/production preview): frontend
 *   and backend are on different hostnames, so use the absolute backend URL.
 * - Web without VITE_TIMECORE_URL (local dev): Vite proxy handles relative
 *   paths, so use '' (same-origin).
 */
const _isNativeWebView =
  typeof window !== 'undefined' &&
  typeof (window as unknown as Record<string, unknown>).Capacitor !== 'undefined' &&
  (
    window as unknown as { Capacitor: { isNativePlatform: () => boolean } }
  ).Capacitor.isNativePlatform();

const _hasExplicitApiUrl = !!(
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: Record<string, string> }).env?.VITE_TIMECORE_URL
);

export const METEOR_API_BASE: string =
  _isNativeWebView || _hasExplicitApiUrl ? METEOR_BASE_URL : '';

const FORCED_TIMEZONE: string | undefined =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_FORCE_TIMEZONE?.trim()) ||
  undefined;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimecoreUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  emailVerified: boolean;
  image?: string | null;
  backgroundUrl?: string | null;
  /** Canonical username — null until the user has claimed one. */
  username: string | null;
  organizationMembership?: {
    organizationId: string;
    organizationSlug: string;
    role: 'owner' | 'admin';
  } | null;
  organizations?: Array<{
    id: string;
    name: string;
    slug: string;
    enterpriseId: string | null;
    role: 'owner' | 'admin' | 'member';
    allowAutoJoin: boolean;
  }>;
}

export interface AuthAccount {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  scopes: string[];
}

export interface PublicUser {
  id: string;
  name: string;
  /** Canonical username/handle. Null until the user claims one. */
  username: string | null;
  image: string | null;
  backgroundUrl: string | null;
  bio: string;
  website: string;
  reportsTo: { id: string; name: string; username: string | null } | null;
  teamMemberships: Array<{ id: string; name: string; role: 'admin' | 'member' }>;
  /** Teams shared between the viewer and this user (non-personal). Empty for own profile. */
  sharedTeams?: Array<{ id: string; name: string; isAdmin: boolean }>;
}

function toAbsoluteUrl(url: string | null): string | null {
  if (!url || /^https?:\/\//i.test(url)) return url;
  const base = url.startsWith('/uploads/') ? METEOR_BASE_URL : TIMECORE_BASE_URL;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function withAbsoluteImage(user: PublicUser): PublicUser {
  const image = toAbsoluteUrl(user.image);
  const backgroundUrl = toAbsoluteUrl(user.backgroundUrl);
  if (image === user.image && backgroundUrl === user.backgroundUrl) return user;
  return { ...user, image, backgroundUrl };
}

/** API error that carries the HTTP status code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Meteor.Error code (e.g. 'plan-required'), when the backend provided one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Token storage (for Capacitor / custom-scheme WebViews where cookies are unreliable) ──

const TOKEN_KEY = 'timecore_session_token';

export const sessionToken = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// ─── JWT access token (stateless auth for the Meteor backend) ──────────────────────

let cachedJwt: { token: string; exp: number } | null = null;
let jwtFetch: Promise<string | null> | null = null;

/** Decode the `exp` claim (seconds since epoch) from a JWT, or 0 on failure. */
export function decodeJwtExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * Get a short-lived JWT access token from better-auth (`GET /api/auth/token`),
 * cached until ~60s before expiry. Falls back to Meteor resume token when no
 * Fastify session is available. Returns null when signed out.
 */
export async function getAccessToken(): Promise<string | null> {
  // First try cached JWT (still valid for Fastify sessions)
  if (cachedJwt && cachedJwt.exp * 1000 - Date.now() > 60_000) return cachedJwt.token;

  // Fall back to Meteor resume token for Meteor-authenticated users
  const meteorToken = localStorage.getItem('meteor_resume_token');
  if (meteorToken) return meteorToken;

  // Try Fastify JWT if we have a session token
  const session = sessionToken.get();
  if (!session) return null;

  jwtFetch ??= (async () => {
    try {
      const res = await fetch(`${TIMECORE_BASE_URL}/api/auth/token`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { token?: string };
      if (!data.token) return null;
      cachedJwt = { token: data.token, exp: decodeJwtExp(data.token) };
      return data.token;
    } catch {
      return null;
    } finally {
      jwtFetch = null;
    }
  })();
  return jwtFetch;
}

/** Drop the cached JWT (on sign-out). */
export function clearAccessToken(): void {
  cachedJwt = null;
}

// ─── Base request ─────────────────────────────────────────────────────────────

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const hasBody = options.body != null;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const token = await getAccessToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () =>
      controller.abort(new Error('Request timed out. Please check your connection and try again.')),
    8000,
  );
  // overwrite the merged headers object (which would drop Authorization).
  const { headers: optHeaders, ...restOptions } = options;
  try {
    const res = await fetch(`${TIMECORE_BASE_URL}${path}`, {
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...optHeaders,
      },
      ...restOptions,
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError(
        (body.message as string | undefined) ??
          (body.error as string | undefined) ??
          `HTTP ${res.status}`,
        res.status,
      );
    }

    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

/** fetch() with an 8-second abort timeout — prevents indefinite hangs on slow connections. */
async function timedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () =>
      controller.abort(new Error('Request timed out. Please check your connection and try again.')),
    8000,
  );
  try {
    return await fetch(url, { signal: controller.signal, ...options });
  } finally {
    clearTimeout(timeoutId);
  }
}

export const authApi = {
  /** Dev-only sign-in used by the login probe. */
  devMemberSignIn: async (
    domain: 'enterprise' | 'organization' = 'organization',
    role: 'member' | 'admin' | 'owner' = 'member',
    joinTeam = false,
  ): Promise<{ token?: string; user?: TimecoreUser }> => {
    const res = await timedFetch(`${TIMECORE_BASE_URL}/api/auth/dev/member-sign-in`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, role, joinTeam }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        (body.message as string | undefined) ??
          (body.error as string | undefined) ??
          `HTTP ${res.status}`,
      );
    }
    const token = res.headers.get('set-auth-token');
    if (token) sessionToken.set(token);
    return res.json();
  },

  /**
   * Initiate a social OAuth sign-in (GitHub / Google / Apple).
   * Returns the provider redirect URL; caller should set window.location.href to it.
   */
  signInWithSocial: async (
    provider: 'github' | 'google' | 'apple',
    callbackURL: string,
  ): Promise<string> => {
    const res = await fetch(`${TIMECORE_BASE_URL}/api/auth/sign-in/social`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, callbackURL }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        (body.message as string | undefined) ??
          (body.error as string | undefined) ??
          `HTTP ${res.status}`,
      );
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  },

  /**
   * Initiate a generic OAuth2 / OIDC sign-in (e.g. Authentik) via the
   * better-auth `genericOAuth` plugin. Returns the provider redirect URL.
   */
  signInWithOAuth2: async (providerId: string, callbackURL: string): Promise<string> => {
    const res = await fetch(`${TIMECORE_BASE_URL}/api/auth/sign-in/oauth2`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, callbackURL }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new Error(
        (body.message as string | undefined) ??
          (body.error as string | undefined) ??
          `HTTP ${res.status}`,
      );
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  },

  /** Initiate linking a social provider to the currently authenticated user. */
  linkSocial: async (provider: 'github' | 'google', callbackURL: string): Promise<string> => {
    const data = await request<{ url: string }>('/api/auth/link-social', {
      method: 'POST',
      body: JSON.stringify({ provider, callbackURL }),
    });
    return data.url;
  },

  /** Remove a linked auth provider from the current account. */
  unlinkAccount: async (providerId: string): Promise<void> => {
    await request('/api/auth/unlink-account', {
      method: 'POST',
      body: JSON.stringify({ providerId }),
    });
  },

  /** List auth providers linked to the current account. */
  listAccounts: async (): Promise<AuthAccount[]> => {
    try {
      return await request<AuthAccount[]>('/api/auth/list-accounts');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return [];
      throw err;
    }
  },

  /** Sign out — clears better-auth session cookie and stored token. */
  signOut: async () => {
    await request('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
    sessionToken.clear();
    clearAccessToken();
  },

  /**
   * Fetch the currently authenticated user.
   * Returns null on 401 (not authenticated), throws on other errors.
   */
  getMe: async (): Promise<{ user: TimecoreUser } | null> => {
    try {
      const data = await request<{ user: TimecoreUser }>('/v1/me');
      if (data?.user?.image && !/^https?:\/\//i.test(data.user.image)) {
        data.user.image = `${TIMECORE_BASE_URL}${data.user.image.startsWith('/') ? '' : '/'}${data.user.image}`;
      }
      if (data?.user?.backgroundUrl && !/^https?:\/\//i.test(data.user.backgroundUrl)) {
        data.user.backgroundUrl = `${TIMECORE_BASE_URL}${data.user.backgroundUrl.startsWith('/') ? '' : '/'}${data.user.backgroundUrl}`;
      }
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
};

// ─── User API ─────────────────────────────────────────────────────────────────

export const userApi = {
  uploadAvatar: async (blob: Blob): Promise<{ avatarUrl: string }> => {
    const formData = new FormData();
    formData.append('avatar', blob, 'avatar.png');
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/me/avatar`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError((body.error as string) ?? `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as { avatarUrl: string };
    return { avatarUrl: toAbsoluteUrl(data.avatarUrl) as string };
  },

  deleteAvatar: async (): Promise<void> => {
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/me/avatar`, {
      method: 'DELETE',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  },

  uploadBackground: async (blob: Blob): Promise<{ backgroundUrl: string }> => {
    const formData = new FormData();
    formData.append('background', blob, 'background.jpg');
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/me/background`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: formData,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError((body.error as string) ?? `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as { backgroundUrl: string };
    return { backgroundUrl: toAbsoluteUrl(data.backgroundUrl) as string };
  },

  deleteBackground: async (): Promise<void> => {
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/me/background`, {
      method: 'DELETE',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
  },
  getUser: (id: string) =>
    wormholeCall<{ user: PublicUser }>('users.get', { userId: id }).then((r) =>
      withAbsoluteImage(r.user),
    ),

  getUserByUsername: (username: string) =>
    wormholeCall<{ user: PublicUser }>('users.getByUsername', { username }).then((r) =>
      withAbsoluteImage(r.user),
    ),

  getUsers: (ids: string[]) =>
    wormholeCall<{ users: PublicUser[] }>('users.batchGet', { ids }).then((r) =>
      r.users.map(withAbsoluteImage),
    ),

  updateProfile: (data: {
    name?: string;
    image?: string | null;
    bio?: string;
    website?: string;
    reportsToUserId?: string | null;
  }) => wormholeCall<{ user: PublicUser }>('users.updateProfile', data).then((r) => r.user),
};

export type DefaultOrganizationRole = 'owner' | 'admin' | 'member';

export interface OrganizationAdminUser {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
  role: DefaultOrganizationRole;
  reportsToUserId?: string | null;
  blocked?: Array<{ orgId: string; blockedBy: string; blockedAt: string; reason?: string }>;
}

export interface AdminOrganization {
  id: string;
  key: string;
  name: string;
  ownersCount?: number;
  adminsCount?: number;
}

export interface OrganizationInvitation {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'delivery_failed';
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export const orgAdminApi = {
  getOrganization: () =>
    wormholeCall<{ organization: AdminOrganization }>('orgs.adminGet', {}).then(
      (r) => r.organization,
    ),

  updateOrganizationName: (name: string) =>
    wormholeCall<{ organization: AdminOrganization }>('orgs.adminUpdate', { name }).then(
      (r) => r.organization,
    ),

  listUsers: () =>
    wormholeCall<{ users: OrganizationAdminUser[] }>('orgs.adminListUsers', {}).then(
      (r) => r.users,
    ),

  setUserRole: (userId: string, role: DefaultOrganizationRole) =>
    wormholeCall<{ user: { id: string; role: DefaultOrganizationRole } }>('orgs.adminSetUserRole', {
      userId,
      role,
    }).then((r) => r.user),

  updateReportsTo: (userId: string, reportsTo: string | null) =>
    wormholeCall<{ user: { id: string; reportsToUserId: string | null } }>('orgs.updateReportsTo', {
      userId,
      reportsToUserId: reportsTo,
    }).then((r) => r.user),
};

// ─── Public Organization API (for all authenticated users) ──────────────────

export const orgApi = {
  checkSlugAvailability: (slug: string, excludeId?: string) =>
    wormholeCall<{ available: boolean }>('orgs.checkSlug', {
      slug,
      ...(excludeId ? { excludeId } : {}),
    }).then((r) => r.available),

  listOrganizations: () =>
    wormholeCall<{
      organizations: Array<{
        id: string;
        enterpriseId: string | null;
        name: string;
        slug: string;
        allowAutoJoin: boolean;
        role: 'owner' | 'admin' | 'member' | null;
      }>;
    }>('orgs.list', {}).then((r) => r.organizations),

  createOrganization: (data: {
    enterpriseId: string;
    name: string;
    slug?: string;
    allowAutoJoin?: boolean;
  }) =>
    wormholeCall<{
      organization: {
        id: string;
        enterpriseId: string | null;
        name: string;
        slug: string;
        allowAutoJoin: boolean;
        role: 'owner' | 'admin' | 'member' | null;
      };
    }>('orgs.create', data).then((r) => r.organization),

  updateOrganization: (
    id: string,
    data: { name?: string; slug?: string; allowAutoJoin?: boolean },
  ) =>
    wormholeCall<{
      organization: {
        id: string;
        enterpriseId: string | null;
        name: string;
        slug: string;
        allowAutoJoin: boolean;
        role: 'owner' | 'admin' | 'member' | null;
      };
    }>('orgs.update', { orgId: id, ...data }).then((r) => r.organization),

  getOrganizationById: (id: string) =>
    wormholeCall<{
      organization: {
        id: string;
        enterpriseId: string | null;
        name: string;
        slug: string;
        allowAutoJoin: boolean;
        role: 'owner' | 'admin' | 'member' | null;
        canManage: boolean;
      };
    }>('orgs.get', { orgId: id }).then((r) => r.organization),

  updateSettings: (id: string, allowAutoJoin: boolean) =>
    wormholeCall<{ organization: { orgId: string; allowAutoJoin: boolean } }>(
      'orgs.updateSettings',
      { orgId: id, allowAutoJoin },
    ).then((r) => r.organization),

  joinOrganization: (id: string) =>
    wormholeCall<{ membership: { orgId: string; role: 'owner' | 'admin' | 'member' } }>(
      'orgs.join',
      { orgId: id },
    ).then((r) => r.membership),

  listMembers: (id: string) =>
    wormholeCall<{ users: OrganizationAdminUser[] }>('orgs.listMembers', { orgId: id }).then(
      (r) => r.users,
    ),

  listOrganizationUsers: (id: string) =>
    wormholeCall<{ users: OrganizationAdminUser[] }>('orgs.listUsers', { orgId: id }).then(
      (r) => r.users,
    ),

  searchUsers: (id: string, q: string) =>
    wormholeCall<{ users: Array<{ id: string; name: string; username: string | null }> }>(
      'orgs.searchUsers',
      { orgId: id, q },
    ).then((r) => r.users),

  setMemberRole: (id: string, userId: string, role: DefaultOrganizationRole) =>
    wormholeCall<{ user: { userId: string; role: DefaultOrganizationRole } }>(
      'orgs.setMemberRole',
      { orgId: id, userId, role },
    ).then((r) => r.user),

  removeMember: (id: string, userId: string) =>
    wormholeCall<{ user: { userId: string } }>('orgs.removeMember', { orgId: id, userId }).then(
      (r) => r.user,
    ),

  inviteMember: (id: string, email: string) =>
    wormholeCall<
      | { ok: true; status: 'joined' }
      | { ok: true; status: 'pending'; invitationId: string; expiresAt: string }
    >('orgs.invite', { orgId: id, email }),

  getPendingInvitations: (id: string) =>
    wormholeCall<{ invitations: OrganizationInvitation[] }>('orgs.getPendingInvitations', {
      orgId: id,
    }).then((r) => r.invitations),

  revokeInvitation: (invitationId: string) =>
    wormholeCall<{ ok: boolean }>('orgs.revokeInvite', { invitationId }),

  blockMember: (id: string, targetUserId: string, reason?: string) =>
    wormholeCall<{
      user: {
        id: string;
        blocked: { orgId: string; blockedBy: string; blockedAt: string; reason?: string };
      };
    }>('orgs.blockMember', { orgId: id, targetUserId, reason }).then((r) => r.user),

  unblockMember: (id: string, targetUserId: string) =>
    wormholeCall<{ user: { id: string } }>('orgs.unblockMember', { orgId: id, targetUserId }).then(
      (r) => r.user,
    ),

  updateMemberReportsTo: (id: string, userId: string, reportsTo: string | null) =>
    wormholeCall<{ user: { id: string; reportsToUserId: string | null } }>(
      'orgs.updateMemberReportsTo',
      { orgId: id, userId, reportsToUserId: reportsTo },
    ).then((r) => r.user),

  updateReportsTo: (userId: string, reportsTo: string | null) =>
    wormholeCall<{ user: { id: string; reportsToUserId: string | null } }>('orgs.updateReportsTo', {
      userId,
      reportsToUserId: reportsTo,
    }).then((r) => r.user),

  getOrganization: () =>
    wormholeCall<{ organization: AdminOrganization }>('orgs.publicGet', {}).then(
      (r) => r.organization,
    ),

  listUsers: () =>
    wormholeCall<{ users: OrganizationAdminUser[] }>('orgs.publicListUsers', {}).then(
      (r) => r.users,
    ),
};

export const enterpriseApi = {
  list: () =>
    wormholeCall<{
      enterprises: Array<{ id: string; name: string; slug: string; role: 'owner' | 'admin' }>;
    }>('enterprises.list', {}).then((r) => r.enterprises),

  create: (data: { name: string; slug?: string }) =>
    wormholeCall<{
      enterprise: {
        id: string;
        name: string;
        slug: string;
        role: 'owner' | 'admin';
        owners: string[];
        admins: string[];
      };
    }>('enterprises.create', data).then((r) => r.enterprise),

  get: (id: string) =>
    wormholeCall<{
      enterprise: {
        id: string;
        name: string;
        slug: string;
        role: 'owner' | 'admin';
        owners: string[];
        admins: string[];
        members: Array<{
          id: string;
          name: string;
          username: string | null;
          role: 'owner' | 'admin';
        }>;
      };
    }>('enterprises.get', { enterpriseId: id }).then((r) => r.enterprise),

  updateName: (id: string, name: string) =>
    wormholeCall<{
      enterprise: {
        id: string;
        name: string;
        slug: string;
        role: 'owner' | 'admin';
        owners: string[];
        admins: string[];
        members: Array<{
          id: string;
          name: string;
          username: string | null;
          role: 'owner' | 'admin';
        }>;
      };
    }>('enterprises.updateName', { enterpriseId: id, name }).then((r) => r.enterprise),

  searchUsers: (id: string, q: string) =>
    wormholeCall<{ users: Array<{ id: string; name: string; username: string | null }> }>(
      'enterprises.searchUsers',
      { enterpriseId: id, q },
    ).then((r) => r.users),

  removeMember: (id: string, userId: string) =>
    wormholeCall<{ userId: string }>('enterprises.removeMember', { enterpriseId: id, userId }),

  setMemberRole: (id: string, userId: string, role: 'owner' | 'admin') =>
    wormholeCall<{ user: { userId: string; role: 'owner' | 'admin' } }>(
      'enterprises.setMemberRole',
      { enterpriseId: id, userId, role },
    ).then((r) => r.user),

  getOwnershipStatus: () =>
    wormholeCall<{ hasOwner: boolean; installCompleted: boolean }>('enterprise.installStatus', {}),

  takeOwnership: () => wormholeCall<{ role: 'owner' }>('enterprises.takeOwnership', {}),
};

export type SeedImportPreview = {
  ok: true;
  value: unknown;
};

export type SeedImportError = {
  ok: false;
  error: { type: string; message: string };
};

export const seedImportApi = {
  parse: (yaml: string) =>
    request<SeedImportPreview | SeedImportError>('/v1/seed/import/parse', {
      method: 'POST',
      body: JSON.stringify({ yaml }),
    }),

  import: (yaml: string, orgId?: string) =>
    request<{
      created: {
        enterprises: number;
        organizations: number;
        teams: number;
        users: number;
        tickets: number;
      };
      updated: {
        enterprises: number;
        organizations: number;
        teams: number;
        users: number;
      };
      summary?: string;
    }>('/v1/seed/import', {
      method: 'POST',
      body: JSON.stringify({ yaml, orgId }),
    }),
};

// ─── Username API ─────────────────────────────────────────────────────────────

export const usernameApi = {
  check: (username: string) =>
    wormholeCall<{ available: boolean; reason?: string | null }>('users.checkUsername', {
      username,
    }),

  claim: (username: string) =>
    wormholeCall<{ username: string }>('users.claimUsername', { username }),
};

// ─── Wormhole (Meteor REST) request ──────────────────────────────────────────

/**
 * Call a Meteor method via the wormhole REST bridge (POST /api/<name with
 * dots→underscores>). Auth is a short-lived better-auth JWT in the
 * Authorization header — the Meteor auth bridge verifies it against the
 * IdP's JWKS (no shared-session coupling).
 */
async function wormholeCall<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const route = method.replace(/\./g, '_');

  // Ensure DDP auth is complete before reading token
  // This guarantees tryResumeLogin has run and updated localStorage
  try {
    await getDdpClient().ensureAuthed();
  } catch {
    // If auth fails, proceed anyway — getAccessToken will handle it
  }

  const token = await getAccessToken();
  const url = `${METEOR_API_BASE}/api/${route}`;

  console.log(`[wormholeCall] ${method}: fetching ${url}`, { hasToken: !!token });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
  } catch (fetchError) {
    console.error(`[wormholeCall] ${method}: fetch failed:`, fetchError);
    throw fetchError;
  }

  console.log(`[wormholeCall] ${method}: got response, status=${res.status}`);

  const data = (await res.json().catch(() => ({}))) as {
    result?: T;
    error?: string;
    reason?: string;
    message?: string;
  };

  // Temporary debug logging for clock.teamStatus and orgs.list
  if (method === 'clock.teamStatus' || method === 'orgs.list') {
    console.log(`[wormholeCall] ${method} response:`, {
      ok: res.ok,
      status: res.status,
      data,
      hasResult: 'result' in data,
      resultKeys: data.result ? Object.keys(data.result) : null,
    });
  }

  if (!res.ok) {
    throw new ApiError(
      data.reason || data.message || `Request failed (${res.status})`,
      res.status,
      data.error,
    );
  }
  return data.result as T;
}

// ─── Ticket API ───────────────────────────────────────────────────────────────

export interface Ticket {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  github: string;
  status: string;
  priority: string | null;
  createdBy: string;
  assignedTo: string[];
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  sharedWithTimeharbor?: boolean;
}

/** Normalize a wormhole ticket payload (raw Mongo doc shape) to the Ticket interface. */
function toTicket(raw: Record<string, unknown>): Ticket {
  const assignedTo = raw.assignedTo;
  return {
    id: String(raw.id ?? raw._id),
    teamId: String(raw.teamId),
    title: String(raw.title),
    description: (raw.description as string | undefined) ?? null,
    github: (raw.github as string | undefined) ?? '',
    status: (raw.status as string | undefined) ?? 'open',
    priority: (raw.priority as string | undefined) ?? null,
    createdBy: String(raw.createdBy),
    assignedTo: Array.isArray(assignedTo)
      ? assignedTo.map(String)
      : typeof assignedTo === 'string'
        ? [assignedTo]
        : [],
    reviewedBy: (raw.reviewedBy as string | undefined) ?? null,
    reviewedAt: (raw.reviewedAt as string | undefined) ?? null,
    createdAt: String(raw.createdAt),
    updatedAt: (raw.updatedAt as string | undefined) ?? null,
    sharedWithTimeharbor: raw.sharedWithTimeharbor as boolean | undefined,
  };
}

export const ticketApi = {
  getTickets: (teamId: string) =>
    wormholeCall<Array<Record<string, unknown>>>('tickets.list', { teamId }).then((tickets) =>
      tickets.map(toTicket),
    ),

  getTicket: (id: string) =>
    wormholeCall<Record<string, unknown>>('tickets.get', { ticketId: id }).then(toTicket),

  createTicket: (data: { teamId: string; title: string; github?: string }) =>
    wormholeCall<Record<string, unknown>>('tickets.create', data).then(toTicket),

  updateTicket: (id: string, updates: { title?: string; github?: string; description?: string }) =>
    wormholeCall<Record<string, unknown>>('tickets.update', { ticketId: id, ...updates }).then(
      toTicket,
    ),

  updateStatusPriority: (id: string, updates: { status?: string; priority?: string }) =>
    wormholeCall<Record<string, unknown>>('tickets.updateStatus', {
      ticketId: id,
      ...updates,
    }).then(toTicket),

  deleteTicket: (id: string) => wormholeCall<{ ok: boolean }>('tickets.delete', { ticketId: id }),

  batchUpdateStatus: (data: { ticketIds: string[]; status: string; teamId: string }) =>
    wormholeCall<{ modified: number }>('tickets.batchStatus', data),

  /**
   * Assignment runs on Meteor: it fans out in-app + push notifications to
   * newly added assignees and emits the activity-log entry.
   */
  assignTicket: (id: string, assignedToUserIds: string[]) =>
    wormholeCall<Record<string, unknown>>('tickets.assign', {
      ticketId: id,
      assignedToUserIds,
    }).then(toTicket),

  /** Get total accumulated seconds for a ticket from Timers. */
  getTotal: (ticketId: string) =>
    wormholeCall<{ totalSeconds: number }>('timers.getTicketTotal', { ticketId }).then(
      (r) => r.totalSeconds,
    ),
};

// ─── Huddle API ───────────────────────────────────────────────────────────────

export interface HuddlePost {
  id: string;
  teamId: string;
  userId: string;
  userName: string;
  userInitials: string;
  content: {
    text: string;
    mentions: string[];
  };
  ticketId?: string;
  ticketTitle?: string;
  attachments: Array<{
    mediaId: string;
    type: 'image' | 'video' | 'file';
    url: string;
    thumbnailUrl?: string;
    filename?: string;
  }>;
  likes: string[];
  commentCount: number;
  /** Client-local calendar date (YYYY-MM-DD) this post is the plan for. */
  postDate?: string;
  /** Set when the author saved a wrap-up edit (plan-first clock flow). */
  wrapUpAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HuddleComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  userInitials: string;
  userAvatarUrl?: string;
  content: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
}

export const huddleApi = {
  /** Fetch all huddle posts for a specific ticket. */
  getPostsByTicket: (ticketId: string) =>
    wormholeCall<{ posts: HuddlePost[] }>('huddle.getPostsByTicket', { ticketId }).then(
      (r) => r.posts,
    ),

  /** The caller's own post for a calendar date (YYYY-MM-DD) in a team, or null. */
  getMyPostForDate: (teamId: string, postDate: string) =>
    wormholeCall<{ post: HuddlePost | null }>('huddle.getMyPostForDate', {
      teamId,
      postDate,
    }).then((r) => r.post),

  /** Update a huddle post. Pass wrapUp to stamp wrapUpAt (plan-first clock flow). */
  updatePost: (
    postId: string,
    content: { text: string; mentions: string[] },
    options?: { wrapUp?: boolean },
  ) => getDdpClient().call('huddle.updatePost', { postId, content, ...options }),

  /** Delete a huddle post. */
  deletePost: (postId: string) => getDdpClient().call('huddle.deletePost', { postId }),

  /** Toggle like on a post */
  toggleLike: (postId: string) => getDdpClient().call('huddle.toggleLike', { postId }),

  /** Get comments for a post */
  getComments: async (postId: string) => {
    const result = await getDdpClient().call('huddle.getComments', { postId });
    return Array.isArray(result) ? result : ((result as { comments?: unknown[] })?.comments ?? []);
  },

  /** Add a comment to a post */
  addComment: (postId: string, data: { content: string; mentions: string[] }) =>
    getDdpClient().call('huddle.addComment', { postId, ...data }),

  /** Delete a comment */
  deleteComment: (commentId: string) => getDdpClient().call('huddle.deleteComment', { commentId }),
};

// ─── Team API ─────────────────────────────────────────────────────────────────

export interface Team {
  id: string;
  orgId: string;
  parentTeamId: string | null;
  name: string;
  description: string | null;
  members: string[];
  admins: string[];
  code: string;
  isPersonal: boolean;
  settings?: {
    requirePlanForClock?: boolean;
  };
  createdAt: string;
  updatedAt: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
}

export interface TeamJoinRequest {
  id: string;
  teamId: string;
  userId: string;
  teamCode: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  requestedAt: string;
  respondedAt?: string;
  respondedBy?: string;
}

export interface TeamJoinRequestWithUser extends TeamJoinRequest {
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface TeamJoinRequestPreview {
  notificationId: string;
  requestId: string;
  teamId: string;
  teamName: string;
  teamDescription: string;
  requester: { id: string; name: string; email: string } | null;
  alreadyProcessed: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'delivery_failed';
  invitedByName: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export const teamApi = {
  getTeams: () =>
    wormholeCall<{ teams: Team[]; pendingRequests: TeamJoinRequest[] }>('teams.list', {}),

  getTeamsOnly: () => wormholeCall<{ teams: Team[] }>('teams.list', {}).then((r) => r.teams),

  ensurePersonal: () =>
    wormholeCall<{ team: Team }>('teams.ensurePersonal', {}).then((r) => r.team),

  createTeam: (data: {
    name: string;
    description?: string;
    orgId?: string;
    parentTeamId?: string | null;
  }) => wormholeCall<{ team: Team }>('teams.create', data).then((r) => r.team),

  getSubTeams: (id: string) =>
    wormholeCall<{ teams: Team[] }>('teams.subteams', { teamId: id }).then((r) => r.teams),

  joinTeam: (teamCode: string) =>
    wormholeCall<
      { status: 'pending'; request: TeamJoinRequest } | { status: 'joined'; team: Team }
    >('teams.join', { teamCode }),

  renameTeam: (id: string, newName: string) =>
    wormholeCall<{ team: Team }>('teams.rename', { teamId: id, newName }).then((r) => r.team),

  updateSettings: (id: string, settings: { requirePlanForClock: boolean }) =>
    wormholeCall<{ team: Team }>('teams.updateSettings', { teamId: id, ...settings }).then(
      (r) => r.team,
    ),

  deleteTeam: (id: string) => wormholeCall<{ ok: boolean }>('teams.delete', { teamId: id }),

  getMembers: (id: string) =>
    wormholeCall<{ members: TeamMember[] }>('teams.getMembers', { teamId: id }).then((r) =>
      r.members.map((m) =>
        m.image && !/^https?:\/\//i.test(m.image)
          ? { ...m, image: `${TIMECORE_BASE_URL}${m.image.startsWith('/') ? '' : '/'}${m.image}` }
          : m,
      ),
    ),

  inviteMember: (id: string, email: string) =>
    wormholeCall<
      | { ok: true; status: 'joined' }
      | { ok: true; status: 'pending'; invitationId: string; expiresAt: string }
    >('teams.invite', { teamId: id, email }),

  removeMember: (id: string, userId: string) =>
    wormholeCall<{ ok: boolean }>('teams.removeMember', { teamId: id, userId }),

  setMemberRole: (id: string, userId: string, role: 'admin' | 'member') =>
    wormholeCall<{ ok: boolean }>('teams.setRole', { teamId: id, userId, role }),

  setMemberPassword: (id: string, userId: string, newPassword: string) =>
    wormholeCall<{ ok: boolean }>('teams.setMemberPassword', { teamId: id, userId, newPassword }),

  getPendingJoinRequests: (teamId: string) =>
    wormholeCall<{ requests: TeamJoinRequestWithUser[] }>('teams.getPendingJoinRequests', {
      teamId,
    }).then((r) => r.requests),

  approveJoinRequest: (requestId: string) =>
    wormholeCall<{ status: string }>('teams.approveJoinRequest', { requestId }),

  declineJoinRequest: (requestId: string) =>
    wormholeCall<{ status: string }>('teams.declineJoinRequest', { requestId }),

  getPendingInvitations: (teamId: string) =>
    wormholeCall<{ invitations: TeamInvitation[] }>('teams.getPendingInvitations', {
      teamId,
    }).then((r) => r.invitations),

  revokeInvitation: (invitationId: string) =>
    wormholeCall<{ ok: boolean }>('teams.revokeInvite', { invitationId }),
};

// ─── Clock API ────────────────────────────────────────────────────────────────

export interface ClockEvent {
  id: string;
  userId: string;
  teamId: string;
  startTime: number;
  /** @deprecated No longer returned by the API — use startTime. */
  originalStartTime?: number;
  accumulatedTime: number;
  breaks?: Array<{
    startTime: number;
    endTime: number | null;
    type?: 'rest' | 'meal';
    classificationSource?: 'auto' | 'manual';
    notes?: string;
  }>;
  workSeconds?: number;
  deductedBreakSeconds?: number;
  totalBreakSeconds?: number;
  isPaused?: boolean;
  /** @deprecated No longer set by the API — use breaks[].endTime === null to find active break. */
  pausedAt?: number | null;
  endTime: number | null;
}

export const clockApi = {
  /** Clock in to a team. Returns the new clock event. */
  start: (teamId: string) => wormholeCall<ClockEvent>('clock.start', { teamId }),

  /** Clock out of a team. */
  stop: (teamId: string) =>
    wormholeCall<ClockEvent>('clock.stop', { teamId, localDate: toDateString(new Date()) }),

  /** Pause an active clock session (break start). */
  pause: (teamId: string) => wormholeCall<ClockEvent>('clock.pause', { teamId }),

  /** Resume a paused clock session (break end). */
  resume: (teamId: string) => wormholeCall<ClockEvent>('clock.resume', { teamId }),

  /** Get active clock status for a team. */
  getStatus: (teamId: string) =>
    wormholeCall<{
      event: ClockEvent;
      workSeconds: number;
      isPaused: boolean;
    } | null>('clock.status', { teamId }),

  /** Get the current user's active clock event (any team), or null. */
  getActive: (_userId?: string) => wormholeCall<ClockEvent | null>('clock.activeForUser', {}),

  /** Get all clock events for the current user. */
  getEvents: () => wormholeCall<ClockEvent[]>('clock.events', {}),

  /** Get timesheet data for a user over a date range (epoch ms boundaries). */
  getTimesheet: (userId: string, startMs: number, endMs: number) =>
    wormholeCall<{
      sessions: ClockEvent[];
      summary: {
        totalSeconds: number;
        totalBreakSeconds: number;
        totalSessions: number;
        completedSessions: number;
        averageSessionSeconds: number;
        workingDays: number;
      };
    }>('clock.timesheet', { userId, startMs, endMs }),

  /** Update a clock event's timestamps and optional break intervals. */
  updateTimes: (
    clockEventId: string,
    data: {
      startTime?: number;
      endTime?: number | null;
      breaks?: Array<{ startTime: number; endTime: number | null }>;
    },
  ) => wormholeCall<ClockEvent>('clock.updateTimes', { clockEventId, ...data }),

  /** Delete a clock event. */
  deleteEvent: (clockEventId: string) =>
    wormholeCall<{ ok: boolean }>('clock.deleteEvent', { clockEventId }).then((r) => r.ok),

  /** Create a completed manual clock entry for a past time range. */
  createManualEntry: (data: { teamId: string; startTime: number; endTime: number }) =>
    wormholeCall<ClockEvent>('clock.createManual', data),
};

// ─── Team Dashboard API ───────────────────────────────────────────────────────

export interface TeamMemberClockStatus {
  userId: string;
  name: string;
  username: string | null;
  image: string | null;
  isClockedIn: boolean;
  isOnBreak: boolean;
  activeClockStart: number | null;
  todaySeconds: number;
}

export interface TeamRunningTimer {
  timerId: string;
  workItemId: string;
  userId: string;
  userName: string;
  userImage: string | null;
  ticketId: string;
  ticketTitle: string;
  startTime: number;
}

export const teamDashboardApi = {
  getTeamClockStatus: (teamId: string) =>
    wormholeCall<{ members: TeamMemberClockStatus[] }>('clock.teamStatus', { teamId }).then((r) =>
      r.members.map((m) =>
        m.image && !/^https?:\/\//i.test(m.image)
          ? { ...m, image: `${TIMECORE_BASE_URL}${m.image.startsWith('/') ? '' : '/'}${m.image}` }
          : m,
      ),
    ),

  getTeamRunningTimers: (teamId: string) =>
    wormholeCall<{ timers: TeamRunningTimer[] }>('timers.getTeamRunning', { teamId }).then((r) =>
      r.timers.map((t) =>
        t.userImage && !/^https?:\/\//i.test(t.userImage)
          ? {
              ...t,
              userImage: `${TIMECORE_BASE_URL}${t.userImage.startsWith('/') ? '' : '/'}${t.userImage}`,
            }
          : t,
      ),
    ),
};

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO
}

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
  getThread: (teamId: string, adminId: string, memberId: string, before?: string) =>
    wormholeCall<{ messages: Message[]; hasMore: boolean }>('messages.getThread', {
      teamId,
      adminId,
      memberId,
      ...(before ? { before } : {}),
    }),

  send: (data: {
    teamId: string;
    toUserId: string;
    text: string;
    adminId: string;
    ticketId?: string;
  }) => wormholeCall<{ message: Message }>('messages.send', data).then((r) => r.message),
};

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
    wormholeCall<{ notifications: Notification[] }>('notifications.getInbox', {}).then(
      (r) => r.notifications,
    ),

  /** Mark a single notification as read. */
  markOneRead: (id: string) =>
    wormholeCall<{ ok: boolean }>('notifications.markOneRead', { notificationId: id }),

  /** Mark all notifications as read. */
  markAllRead: () => wormholeCall<{ ok: boolean }>('notifications.markAllRead', {}),

  /** Bulk-delete notifications by ID. */
  deleteMany: (ids: string[]) =>
    wormholeCall<{ deletedCount: number }>('notifications.deleteMany', { ids }),

  /** Fetch team-invite preview for a notification. */
  getInvitePreview: (id: string) =>
    wormholeCall<TeamInvitePreview>('notifications.getInvitePreview', { notificationId: id }),

  /** Accept or ignore a team invite. */
  respondToInvite: (id: string, action: 'join' | 'ignore') =>
    wormholeCall<{ ok: boolean }>('notifications.respondToInvite', { notificationId: id, action }),

  /** Fetch team join request preview for a notification. */
  getJoinRequestPreview: (id: string) =>
    wormholeCall<TeamJoinRequestPreview>('teams.getJoinRequestPreview', { notificationId: id }),

  /** Approve or decline a team join request. */
  respondToJoinRequest: (id: string, action: 'approve' | 'decline') =>
    wormholeCall<{ ok: boolean }>('teams.respondToJoinRequest', { notificationId: id, action }),

  /** Consent to auto-clockout at 8h — called when user clicks "Agree to Clock Out" on the shift reminder. */
  agreeClockout: (clockEventId: string) =>
    wormholeCall<{ ok: boolean }>('clock.agreeAutoClockout', { clockEventId }),

  /** Send a test push notification to the requesting user's devices. */
  testPush: () => wormholeCall<{ ok: boolean }>('notifications.testPush', {}),
};

// ─── Attachments ──────────────────────────────────────────────────────────────
export type AttachmentKind = 'clock' | 'ticket';
export type AttachmentType = 'video' | 'image' | 'link';

export interface Attachment {
  id: string;
  url: string;
  type: AttachmentType;
  title: string | null;
  thumbnail: string | null;
  attachedTo: { kind: AttachmentKind; id: string };
  addedBy: string;
  addedAt: string;
}

export const attachmentApi = {
  list: (kind: AttachmentKind, id: string) =>
    wormholeCall<{ attachments: Attachment[] }>('attachments.list', { kind, id }).then(
      (r) => r.attachments,
    ),

  add: (data: {
    url: string;
    type: AttachmentType;
    title?: string;
    attachedTo: { kind: AttachmentKind; id: string };
  }) => wormholeCall<{ attachment: Attachment }>('attachments.add', data).then((r) => r.attachment),

  remove: (id: string) => wormholeCall<{ ok: boolean }>('attachments.remove', { attachmentId: id }),
};

// ─── Timer API ────────────────────────────────────────────────────────────────

/** A WorkItem is the per-user per-ticket per-day timesheet row. */
export interface WorkItem {
  id: string;
  userId: string;
  ticketId: string;
  displayTitle: string | null;
  date: string; // UTC "YYYY-MM-DD"
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

/** A Timer is one start–stop interval inside a WorkItem. */
export interface Timer {
  id: string;
  workItemId: string;
  userId: string;
  date: string;
  startTime: number; // epoch ms
  endTime: number | null;
  durationSeconds?: number;
  createdAt: string;
}

export interface DayEntry {
  entry: WorkItem;
  sessions: Timer[];
}

export interface WeekDay {
  date: string;
  totalSeconds: number;
}

/** Returns the browser's IANA timezone string (e.g. "America/New_York"). */
function clientTz(): string {
  if (FORCED_TIMEZONE) {
    try {
      // Validate the IANA timezone so bad local values do not break API calls.
      new Intl.DateTimeFormat('en-US', { timeZone: FORCED_TIMEZONE }).format(new Date());
      return FORCED_TIMEZONE;
    } catch {
      // Fall back to browser timezone.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const timerApi = {
  /** Create a WorkItem for the given ticket + date. Optionally start a timer immediately. */
  createEntry: (data: {
    ticketId: string;
    date: string;
    note?: string;
    notifyAdmins?: boolean;
    startNow?: boolean;
  }) =>
    wormholeCall<{ entry: WorkItem; session: Timer | null }>('timers.createEntry', {
      ...data,
      tz: clientTz(),
    }),

  /** Start a timer for a WorkItem. Closes any open timer first. */
  startSession: (entryId: string, now?: number) =>
    wormholeCall<{ session: Timer; closedSessionId?: string }>('timers.startSession', {
      entryId,
      now: now ?? Date.now(),
      tz: clientTz(),
    }),

  /** Stop a running timer. */
  stopSession: (sessionId: string, now?: number) =>
    wormholeCall<{ session: Timer }>('timers.stopSession', {
      sessionId,
      now: now ?? Date.now(),
    }).then((r) => r.session),

  /** Update a WorkItem's note, duration, and/or ticket (duration ignored while running). */
  updateEntry: (
    entryId: string,
    data: { note?: string | null; durationSeconds?: number; ticketId?: string },
  ) =>
    wormholeCall<{ entry: WorkItem }>('timers.updateEntry', { entryId, ...data }).then(
      (r) => r.entry,
    ),

  /** Delete a WorkItem and all of its timers. */
  deleteEntry: (entryId: string, options?: { notifyAdmins?: boolean }) =>
    wormholeCall<{ deletedEntry: boolean; deletedSessions: number }>('timers.deleteEntry', {
      entryId,
      notifyAdmins: options?.notifyAdmins ?? true,
    }),

  /** Get the currently running timer for the authenticated user, or null. */
  getRunning: () =>
    wormholeCall<{ session: Timer | null }>('timers.getRunning', {}).then((r) => r.session),

  /** Get all entries + sessions for today in local time. Admin can pass userId. */
  getToday: (userId?: string) => {
    const tz = clientTz();
    return wormholeCall<{ entries: DayEntry[] }>('timers.getToday', {
      tz,
      ...(userId ? { userId } : {}),
    }).then((r) => r.entries);
  },

  /** Get all entries + sessions for a local day (YYYY-MM-DD). */
  getDay: (date: string) => {
    const tz = clientTz();
    return wormholeCall<{ entries: DayEntry[] }>('timers.getDay', { date, tz }).then(
      (r) => r.entries,
    );
  },

  /** Get 7-day totals for the week starting at the given date (YYYY-MM-DD). */
  getWeek: (date: string) => {
    const tz = clientTz();
    return wormholeCall<{ days: WeekDay[] }>('timers.getWeek', { date, tz }).then((r) => r.days);
  },

  /** Get total seconds for a ticket from all closed Timers. */
  getTicketTotal: (ticketId: string) =>
    wormholeCall<{ totalSeconds: number }>('timers.getTicketTotal', { ticketId }).then(
      (r) => r.totalSeconds,
    ),

  /**
   * Copy entries from the most recent previous day into toDate.
   * Skips rows that already exist with the same ticket + note + sortOrder signature.
   */
  copyPrevious: (toDate: string) =>
    wormholeCall<{ created: number }>('timers.copyPrevious', { toDate }).then((r) => r.created),
};

// ─── PulseVault video uploads ──────────────────────────────────────────────────────────────────────────────

export const videoApi = {
  /** Shared authenticated TUS upload endpoint for ticket and media-library uploads. */
  uploadEndpoint: () => `${METEOR_API_BASE}/pulsevault/upload`,

  /** Reserve a videoid for a ticket upload before starting TUS.
   *  Pass `existingVideoid` when resuming a recording session so the backend
   *  re-registers the same id instead of creating a new one.
   */
  reserve: (ticketId: string, existingVideoid?: string) =>
    wormholeCall<{ videoid: string; uploadToken: string; uploadLink?: string }>(
      'pulsevault.reserve',
      existingVideoid
        ? { target: 'ticket', ticketId, existingVideoid }
        : { target: 'ticket', ticketId },
    ),

  /** Reserve a videoid for a media library upload (no ticket context). */
  reserveForLibrary: () =>
    wormholeCall<{ videoid: string; uploadToken: string }>('pulsevault.reserveForLibrary', {}),
};

// ─── Media Library ────────────────────────────────────────────────────────────

export interface MediaItem {
  id: string;
  userId: string;
  type: 'video' | 'image' | 'document';
  mimeType: string;
  url: string;
  videoid: string | null;
  filename: string;
  size: number;
  title: string | null;
  caption: string | null;
  altText: string | null;
  thumbnail: string | null;
  uploadedAt: string;
}

function withAbsoluteMediaItem(item: MediaItem): MediaItem {
  const thumbnail = toAbsoluteUrl(item.thumbnail);
  const url = toAbsoluteUrl(item.url) ?? item.url;
  if (thumbnail === item.thumbnail && url === item.url) return item;
  return { ...item, thumbnail, url };
}

export const mediaApi = {
  uploadImage: async (file: File): Promise<MediaItem> => {
    const form = new FormData();
    form.append('file', file, file.name || 'image');
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/media/upload`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError((body.error as string) ?? `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as { item: MediaItem };
    return withAbsoluteMediaItem(data.item);
  },

  list: () =>
    wormholeCall<{ items: MediaItem[] }>('media.list', {}).then((r) =>
      r.items.map(withAbsoluteMediaItem),
    ),

  listForUser: (userId: string) =>
    wormholeCall<{ items: MediaItem[] }>('media.listForUser', { userId }).then((r) =>
      r.items.map(withAbsoluteMediaItem),
    ),

  update: (id: string, data: { title?: string; caption?: string; altText?: string }) =>
    wormholeCall<{ item: MediaItem }>('media.update', { mediaId: id, ...data }).then((r) =>
      withAbsoluteMediaItem(r.item),
    ),

  remove: (id: string) => wormholeCall<{ ok: boolean }>('media.remove', { mediaId: id }),

  uploadThumbnail: async (id: string, blob: Blob): Promise<MediaItem> => {
    const form = new FormData();
    form.append('file', blob, 'thumbnail.jpg');
    const token = await getAccessToken();
    const res = await fetch(`${METEOR_API_BASE}/api/media-thumbnail/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new ApiError((body.error as string) ?? `HTTP ${res.status}`, res.status);
    }
    const data = (await res.json()) as { item: MediaItem };
    return withAbsoluteMediaItem(data.item);
  },
};

// ─── Activity Log ─────────────────────────────────────────────────────────────

export interface ActivityLogItem {
  id: string;
  userId: string;
  teamId?: string;
  type: string;
  actor: { id: string; name: string; avatar?: string };
  payload: Record<string, unknown>;
  occurredAt: string; // ISO 8601
  source: string;
}

export const activityApi = {
  getLog: (params: { limit?: number; before?: string } = {}) =>
    wormholeCall<{ events: ActivityLogItem[]; nextCursor: string | null }>('activity.log', params),

  getUserActivity: (userId: string, params: { limit?: number; before?: string } = {}) =>
    wormholeCall<{ events: ActivityLogItem[]; nextCursor: string | null }>('activity.userLog', {
      userId,
      ...params,
    }),

  /** Ticket IDs + titles from the user's last 48 h of timer work. */
  getUserWorkSummary: (userId: string) =>
    wormholeCall<{ items: { id: string; title: string }[] }>('timers.getUserWorkSummary', {
      userId,
    }),

  getTicketActivity: (ticketId: string, limit = 50) =>
    wormholeCall<{ events: ActivityLogItem[] }>('activity.ticketActivity', { ticketId, limit }),
};

// ─── Channel types ────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  teamId: string;
  name: string;
  description?: string;
  isDefault: boolean;
  /** userIds who can access this channel; empty array means team-wide */
  members: string[];
  createdBy: string;
  createdAt: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  teamId: string;
  fromUserId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

// ─── Channel API ──────────────────────────────────────────────────────────────

export const channelApi = {
  getChannels: (teamId: string): Promise<Channel[]> =>
    wormholeCall<{ channels: Channel[] }>('channels.list', { teamId }).then((r) => r.channels),

  createChannel: (data: {
    teamId: string;
    name: string;
    description?: string;
    members?: string[];
  }): Promise<Channel> =>
    wormholeCall<{ channel: Channel }>('channels.create', data).then((r) => r.channel),

  getMessages: (
    channelId: string,
    teamId: string,
    before?: string,
  ): Promise<{ messages: ChannelMessage[]; hasMore: boolean }> =>
    wormholeCall<{ messages: ChannelMessage[]; hasMore: boolean }>('channels.getMessages', {
      channelId,
      teamId,
      ...(before ? { before } : {}),
    }),

  sendMessage: (
    channelId: string,
    data: { teamId: string; text: string },
  ): Promise<ChannelMessage> =>
    wormholeCall<{ message: ChannelMessage }>('channels.sendMessage', {
      channelId,
      ...data,
    }).then((r) => r.message),

  updateChannel: (
    channelId: string,
    data: { teamId: string; name?: string; description?: string; members?: string[] },
  ): Promise<Channel> =>
    wormholeCall<{ channel: Channel }>('channels.update', {
      channelId,
      ...data,
    }).then((r) => r.channel),

  deleteChannel: (channelId: string, teamId: string): Promise<void> =>
    wormholeCall<{ success: boolean }>('channels.delete', { channelId, teamId }).then(() => {}),
};

// ─── Personal Access Tokens ───────────────────────────────────────────────────

export interface PersonalAccessToken {
  _id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string | null;
}

export const tokenApi = {
  list: (): Promise<PersonalAccessToken[]> =>
    wormholeCall<{ tokens: PersonalAccessToken[] }>('tokens.list', {}).then((r) => r.tokens),

  create: (name: string): Promise<{ token: string; name: string }> =>
    wormholeCall<{ token: string; name: string }>('tokens.create', { name }),

  revoke: (id: string): Promise<void> =>
    wormholeCall<{ success: boolean }>('tokens.revoke', { tokenId: id }).then(() => undefined),
};

// ─── TimeHarbor Share ─────────────────────────────────────────────────────────

/**
 * Flag a single ticket as shared with TimeHarbor.
 * One-way: this only sets the flag on the TimeHuddle record; TimeHarbor pulls it.
 */
export const shareTicketWithTimeharbor = (id: string, shared: boolean): Promise<void> =>
  wormholeCall<{ ok: boolean }>('tickets.shareWithTimeharbor', { ticketId: id, shared }).then(
    () => undefined,
  );

/**
 * Flag multiple tickets as shared with (or unshared from) TimeHarbor in one request.
 */
export const bulkShareTicketsWithTimeharbor = (
  ticketIds: string[],
  shared: boolean,
): Promise<void> =>
  wormholeCall<{ modifiedCount: number }>('tickets.bulkShareWithTimeharbor', {
    ticketIds,
    shared,
  }).then(() => undefined);
