/**
 * Team-selection fixture helpers.
 *
 * The seed data provisions a shared team "Test Team Alpha" (code TEST01) that
 * every @test.local user is a member of. Tests that need two sessions to share
 * a feed (Huddle posts, Yjs collab editing, real-time sync) must switch away
 * from each user's separate Personal team into this shared team, otherwise
 * they compare two disjoint feeds.
 *
 * The frontend persists the active team in localStorage under
 * `app:selectedTeamId` (plus per-org keyed variants). We set both and reload
 * so the app boots into the shared team.
 */
import type { Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/** Look up the ObjectId of the shared seed team by its code. */
export async function getTeamIdByCode(code: string): Promise<string | null> {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const team = await client.db().collection('teams').findOne({ code });
    return team ? String(team._id) : null;
  } finally {
    await client.close();
  }
}

/**
 * Force the given page onto the shared "Test Team Alpha" (TEST01) team by
 * writing every `app:selectedTeamId*` localStorage key and reloading.
 *
 * Requires the page to already be on an in-app route so localStorage is
 * writable for the app origin.
 */
export async function selectSharedTestTeam(page: Page): Promise<string> {
  const teamId = await getTeamIdByCode('TEST01');
  if (!teamId) {
    throw new Error('Shared seed team TEST01 not found — did global-setup run?');
  }
  await page.evaluate((id) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('app:selectedTeamId'))
      .forEach((k) => localStorage.setItem(k, id));
    localStorage.setItem('app:selectedTeamId', id);
  }, teamId);
  await page.reload();
  await page.waitForLoadState('networkidle');
  return teamId;
}
