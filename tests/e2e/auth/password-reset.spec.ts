/**
 * Password Reset E2E Regression Test
 *
 * Verifies the full password-reset flow end-to-end against a live Meteor
 * backend + Mailpit SMTP sink:
 *
 *   1. Create a fresh user via DDP `accounts.createUser`
 *   2. Request a reset email via the /login?mode=forgot UI
 *   3. Fetch the reset URL from Mailpit's REST API
 *   4. Open the reset link, submit a new password
 *   5. Sign in with the new password and land in the app
 *
 * Requirements to run locally:
 *   - Meteor backend up on :3100
 *   - Vite frontend up on :3000
 *   - Mailpit running (`brew services start mailpit`) on 1025/8025
 */
import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const METEOR_WS = process.env.METEOR_WS ?? 'ws://localhost:3101/websocket';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

interface MailpitList {
  total: number;
  messages: MailpitMessage[];
}

interface MailpitDetail {
  Text?: string;
  HTML?: string;
}

/** Minimal DDP client for provisioning test data. */
async function ddpCall<T = unknown>(method: string, params: unknown[]): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const ws = new WebSocket(METEOR_WS);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`DDP ${method} timeout`));
    }, 10_000);
    let msgId = 0;
    ws.on('open', () => ws.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] })));
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.msg === 'connected') {
        ws.send(
          JSON.stringify({
            msg: 'method',
            method,
            params,
            id: String(++msgId),
          }),
        );
      }
      if (msg.msg === 'result') {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(msg.error.reason ?? msg.error.message));
        else resolve(msg.result as T);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

async function waitForResetEmail(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as MailpitList;
    const match = list.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) &&
        /reset/i.test(m.Subject),
    );
    if (match) {
      const detail = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)
      ).json()) as MailpitDetail;
      const body = detail.Text ?? detail.HTML ?? '';
      const url = body.match(/https?:\/\/\S+reset-password\?token=[^\s"<>]+/)?.[0];
      if (url) return url;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No reset email arrived for ${email} within ${timeoutMs}ms`);
}

test.describe('Password Reset', () => {
  test('user can request reset, set new password via email link, and sign in', async ({ page }) => {
    // ── Setup: fresh user, clean inbox ──────────────────────────────────────
    const stamp = Date.now();
    const email = `pw-reset-${stamp}@example.com`;
    const initialPassword = 'InitPass123!';
    const newPassword = 'ResetNewPass123!';

    await clearMailpit();
    await ddpCall<{ userId: string }>('accounts.createUser', [
      { email, password: initialPassword, name: `Reset Test ${stamp}` },
    ]);

    // ── 1. Request reset via the forgot-password form ───────────────────────
    await page.goto('/login?mode=forgot');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/check your email for a reset link/i)).toBeVisible({
      timeout: 10_000,
    });

    // ── 2. Grab the reset link from Mailpit ─────────────────────────────────
    const resetUrl = await waitForResetEmail(email);
    expect(resetUrl).toMatch(/\/reset-password\?token=/);

    // ── 3. Follow the link and submit a new password ────────────────────────
    await page.goto(resetUrl);
    await expect(page.getByRole('heading', { name: /set a new password/i })).toBeVisible();

    await page.getByRole('textbox', { name: 'New password' }).fill(newPassword);
    await page.getByRole('textbox', { name: 'Confirm password' }).fill(newPassword);
    await page.getByRole('button', { name: /set new password/i }).click();

    await expect(page.getByText(/password reset successfully/i)).toBeVisible({ timeout: 10_000 });

    // ── 4. Sign in with the new password ────────────────────────────────────
    await page.goto('/login?mode=login');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(newPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // A successful sign-in either redirects to /app/* or (for brand-new
    // accounts) shows the username claim dialog. Both count as authenticated.
    const claimDialog = page.getByRole('heading', { name: /username required/i });
    const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(claimDialog.or(mainNav).first()).toBeVisible({ timeout: 15_000 });
  });

  test('old password no longer works after reset', async ({ page }) => {
    const stamp = Date.now();
    const email = `pw-oldpass-${stamp}@example.com`;
    const initialPassword = 'InitPass123!';
    const newPassword = 'BrandNewPass123!';

    await clearMailpit();
    await ddpCall('accounts.createUser', [
      { email, password: initialPassword, name: `Old Pass Test ${stamp}` },
    ]);

    // Trigger + follow reset
    await page.goto('/login?mode=forgot');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    const resetUrl = await waitForResetEmail(email);
    await page.goto(resetUrl);
    await page.getByRole('textbox', { name: 'New password' }).fill(newPassword);
    await page.getByRole('textbox', { name: 'Confirm password' }).fill(newPassword);
    await page.getByRole('button', { name: /set new password/i }).click();
    await expect(page.getByText(/password reset successfully/i)).toBeVisible({
      timeout: 10_000,
    });

    // Attempt sign-in with the ORIGINAL password — must fail
    await page.goto('/login?mode=login');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(initialPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText(/invalid/i, {
      timeout: 5_000,
    });
  });
});
