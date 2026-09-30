/**
 * Test user factory with role-based fixtures.
 * Maps seed users to roles (owner, admin, member) for E2E testing.
 */
import type { Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

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
/** The Meteor backend the e2e frontend proxies to — same default as playwright.config.ts. */
const BACKEND_URL = process.env.VITE_TIMECORE_URL ?? 'http://localhost:3101';

export async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto('/app');
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button:has-text("Sign in")');

  // Wait for redirect to dashboard (login success indicator).
  //
  // This budget must stay BELOW the per-test timeout in playwright.config.ts
  // (45s). It used to be 60s, which the test timeout could never reach: a
  // login slower than 45s killed the test first, so the extra 15s was dead
  // budget and the failure surfaced as a bare "Test timeout exceeded" with no
  // hint that login was the thing that stalled.
  try {
    await page.waitForURL('**/dashboard', { timeout: 30000 });
  } catch (err) {
    // Distinguish "the backend is down" from "the app failed to navigate".
    // A crashed Meteor backend makes every spec fail identically at this line,
    // which reads like a product regression until you check /health.
    const health = await page.request
      .get(`${BACKEND_URL}/health`, { timeout: 5000 })
      .then((r) => (r.ok() ? 'ok' : `HTTP ${r.status()}`))
      .catch((e: Error) => `unreachable (${e.message})`);
    if (health !== 'ok') {
      throw new Error(
        `loginAs(${user.email}) failed because the Meteor test backend is not healthy ` +
          `(/health -> ${health}). This is an environment failure, not a product bug. ` +
          `Restart it with: pm2 restart timehuddle-meteor-test`,
      );
    }
    throw err;
  }
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

/** The seed user's `_id`, needed to build `/app/profile/:id` deep links. */
export async function getUserIdByEmail(email: string): Promise<string> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const user = await client
      .db()
      .collection('users')
      .findOne({ 'emails.address': email }, { projection: { _id: 1 } });
    if (!user) throw new Error(`Seed user ${email} not found — did global-setup run?`);
    return String(user._id);
  } finally {
    await client.close();
  }
}
