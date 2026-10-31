/**
 * Pulse video card helpers.
 *
 * A Pulse video shows as a card (PulseVideoPlayer) — its poster with a Play
 * button — not as a link, wherever it appears: Huddle posts, a ticket's or a
 * clock session's Videos, a timesheet walkthrough. The player only mounts on
 * Play, so its URL is read from the `<video>` it starts: the one that
 * replaces the button, or in Huddle, the conversation's media view.
 */
import { expect, type Locator } from '@playwright/test';

/**
 * Play the Pulse video card inside `scope` and return the URL it plays, which
 * is the PulseVault artifact (`/pulsevault/artifacts/<videoid>`). Pass
 * `videoid` to require that exact artifact. The page is left as it was: in
 * Huddle, the media view the card opened is closed again.
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
      `.pulse-video-card video${src}, [data-slot="superchat-media-view"] [data-active="true"] video${src}`,
    );
  await expect(player.first()).toBeVisible();
  const played = (await player.first().getAttribute('src'))!;
  // In Huddle the card opened the conversation's media view in place of the
  // thread: go back, so the post is there for whatever the test checks next.
  const back = scope.page().getByRole('button', { name: 'Back to conversation', exact: true });
  if (await back.isVisible()) await back.click();
  return played;
}
