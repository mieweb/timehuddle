/**
 * Pulse video card helpers.
 *
 * A Pulse video shows as a card (PulseVideoPlayer) — its poster with a Play
 * button — not as a link, wherever it appears: Huddle posts, a ticket's or a
 * clock session's Videos, a timesheet walkthrough. Its Play opens a feed that
 * plays it — Huddle's media view, or VideoFeedView over the page elsewhere —
 * so its URL is read from the `<video>` playing there.
 */
import { expect, type Locator } from '@playwright/test';

/**
 * Play the Pulse video card inside `scope` and return the URL it plays, which
 * is the PulseVault artifact (`/pulsevault/artifacts/<videoid>`). Pass
 * `videoid` to require that exact artifact. The page is left as it was: the
 * feed that opened is closed again.
 */
export async function playPulseVideoCard(
  scope: Locator,
  { videoid, timeout = 10000 }: { videoid?: string; timeout?: number } = {},
): Promise<string> {
  const play = scope
    .locator('.pulse-video-card')
    .getByRole('button', { name: /^Play / })
    .first();
  await expect(play).toBeVisible({ timeout });
  await play.click();
  const src = `[src*="/pulsevault/artifacts/${videoid ?? ''}"]`;
  const player = scope
    .page()
    .locator(
      `.video-feed-view [data-active="true"] video${src}, [data-slot="superchat-media-view"] [data-active="true"] video${src}`,
    );
  await expect(player.first()).toBeVisible();
  const played = (await player.first().getAttribute('src'))!;
  // Back out of the feed, so the post or the list is there for whatever the
  // test checks next.
  const feed = scope.page().getByRole('dialog', { name: 'Videos' });
  if (await feed.isVisible()) {
    await feed.getByRole('button', { name: 'Back', exact: true }).click();
  } else {
    const back = scope.page().getByRole('button', { name: 'Back to conversation', exact: true });
    if (await back.isVisible()) await back.click();
  }
  return played;
}
