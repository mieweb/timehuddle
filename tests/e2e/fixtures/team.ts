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

let cachedSharedTeamId: string | null = null;

/** Look up the ObjectId of the shared seed team by its code. */
export async function getTeamIdByCode(code: string): Promise<string | null> {
  if (code === 'TEST01' && cachedSharedTeamId) return cachedSharedTeamId;
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const team = await client.db().collection('teams').findOne({ code });
    const id = team ? String(team._id) : null;
    if (code === 'TEST01') cachedSharedTeamId = id;
    return id;
  } finally {
    await client.close();
  }
}

/**
 * Force the given page onto the shared "Test Team Alpha" (TEST01) team by
 * writing every `app:selectedTeamId*` localStorage key and reloading.
 */
export async function selectSharedTestTeam(page: Page): Promise<string> {
  const teamId = await getTeamIdByCode('TEST01');
  if (!teamId) {
    throw new Error('Shared seed team TEST01 not found — did global-setup run?');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const alreadySelected = await page.evaluate((id) => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('app:selectedTeamId'));
      if (keys.length > 0 && keys.every((k) => localStorage.getItem(k) === id)) {
        return true;
      }
      keys.forEach((k) => localStorage.setItem(k, id));
      localStorage.setItem('app:selectedTeamId', id);
      return false;
    }, teamId);

    if (alreadySelected) return teamId;

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const settled = await page
      .waitForFunction(
        (id) =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('app:selectedTeamId'))
            .every((k) => localStorage.getItem(k) === id),
        teamId,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);

    if (settled) return teamId;
  }

  throw new Error(
    `Could not switch to shared team ${teamId} — TeamContext keeps reverting to the personal team.`,
  );
}
