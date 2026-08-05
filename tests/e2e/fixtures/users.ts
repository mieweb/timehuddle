/**
 * Test user factory with role-based fixtures.
 * Maps seed users to roles (owner, admin, member) for E2E testing.
 */
import type { Page } from '@playwright/test';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
}

/**
 * Test users from seed data (backend/scripts/seed.ts).
 * All users share the same password: "TestPass1!"
 */
export const TEST_USERS = {
  // Organization owners
  owner1: {
    email: 'owner1@test.local',
    password: 'TestPass1!',
    name: 'Test Owner One',
    role: 'owner' as const,
  },
  owner2: {
    email: 'owner2@test.local',
    password: 'TestPass1!',
    name: 'Test Owner Two',
    role: 'owner' as const,
  },

  // Team admins
  admin1: {
    email: 'admin1@test.local',
    password: 'TestPass1!',
    name: 'Test Admin One',
    role: 'admin' as const,
  },
  admin2: {
    email: 'admin2@test.local',
    password: 'TestPass1!',
    name: 'Test Admin Two',
    role: 'admin' as const,
  },
  admin3: {
    email: 'admin3@test.local',
    password: 'TestPass1!',
    name: 'Test Admin Three',
    role: 'admin' as const,
  },

  // Regular members
  member1: {
    email: 'member1@test.local',
    password: 'TestPass1!',
    name: 'Test Member One',
    role: 'member' as const,
  },
  member2: {
    email: 'member2@test.local',
    password: 'TestPass1!',
    name: 'Test Member Two',
    role: 'member' as const,
  },
  member3: {
    email: 'member3@test.local',
    password: 'TestPass1!',
    name: 'Test Member Three',
    role: 'member' as const,
  },
  member4: {
    email: 'member4@test.local',
    password: 'TestPass1!',
    name: 'Test Member Four',
    role: 'member' as const,
  },
  member5: {
    email: 'member5@test.local',
    password: 'TestPass1!',
    name: 'Test Member Five',
    role: 'member' as const,
  },
} as const;

/**
 * Login helper — navigates to /app and performs email/password login.
 * Waits for redirect to /app/dashboard to confirm successful authentication.
 */
export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/app');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button:has-text("Sign in")');

  // Wait for redirect to dashboard (login success indicator). The timeout is
  // generous because the first DDP WebSocket connection can be slow when the
  // backend is cold-starting (connectWithRetry does up to 3 attempts with
  // backoff, ~46s worst case) — a shorter window makes login flaky. On a busy
  // dev machine (many meteor/mongod processes competing for CPU during a long
  // sequential suite run) this can occasionally take even longer, so the
  // budget has extra headroom beyond the worst-case DDP retry math.
  await page.waitForURL('**/dashboard', { timeout: 60000 });

  // Let the initial data fetches settle before the test starts navigating —
  // otherwise the very next `page.goto()` can race the session-cookie handshake
  // and bounce back to the login screen. `networkidle` waits until there are
  // no in-flight requests for 500ms, which reliably covers the post-login
  // fanout (session, orgs, teams, clock, etc.).
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

/**
 * Get a test user by role.
 * Returns the first user with the specified role.
 */
export function getUserByRole(role: 'owner' | 'admin' | 'member'): TestUser {
  if (role === 'owner') return TEST_USERS.owner1;
  if (role === 'admin') return TEST_USERS.admin1;
  return TEST_USERS.member1;
}

/**
 * Get all test users with a specific role.
 */
export function getAllUsersByRole(role: 'owner' | 'admin' | 'member'): TestUser[] {
  return Object.values(TEST_USERS).filter((u) => u.role === role);
}
