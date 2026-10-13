/**
 * Pulse video card helpers.
 *
 * A Pulse video shows as a card (PulseVideoPlayer) — its poster with a Play
 * button — not as a link, wherever it appears: Huddle posts, a ticket's or a
 * clock session's Videos, a timesheet walkthrough. The player only mounts on
 * Play, so its URL is read from the `<video>` that replaces the button.
 */
import { expect, type Locator } from '@playwright/test';

/**
 * Play the Pulse video card inside `scope` and return the URL it plays, which
 * is the PulseVault artifact (`/pulsevault/artifacts/<videoid>`). Pass
 * `videoid` to require that exact artifact.
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
  const player = scope.locator(
    `.pulse-video-card video[src*="/pulsevault/artifacts/${videoid ?? ''}"]`,
  );
  await expect(player.first()).toBeVisible();
  return (await player.first().getAttribute('src'))!;
}
