/**
 * API Token Integration E2E
 *
 * Guards the full lifecycle of a personal access token (PAT):
 *   1. Navigate to Settings → API Tokens section
 *   2. Generate a token — verify the one-time reveal appears
 *   3. Copy the token value from the DOM
 *   4. Token is listed in the token list
 *   5. Use the token as Bearer auth against the backend API
 *   6. Revoke the token — it disappears from the list
 *   7. Verify the token is rejected (401) after revocation
 *
 * If this test breaks, integrations that rely on PAT authentication are broken.
 */
import { expect, test } from '@playwright/test';

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSWORD = 'Password1!';
const API_BASE = 'http://localhost:4000/v1';
const PAT_PREFIX = 'th_pat_';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

async function goToSettings(page: import('@playwright/test').Page) {
  await page.goto('/app/settings');
  // Wait for the API Tokens section heading to appear
  await page.waitForSelector('text=API Tokens', { timeout: 10000 });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('API Token — Settings page lifecycle', () => {
  test.setTimeout(90000);

  test('generates a PAT, verifies it works via API, then revokes it and confirms 401', async ({
    page,
    request,
  }) => {
    await login(page);
    await goToSettings(page);

    // Scroll the API Tokens section into view
    const apiTokensSection = page.getByText('API Tokens').first();
    await apiTokensSection.scrollIntoViewIfNeeded();

    // ── Step 1: Generate a token ───────────────────────────────────────────────

    const tokenName = `e2e-integration-${Date.now()}`;

    const nameInput = page.getByPlaceholder('Token name (e.g. TimeHarbor)');
    await expect(nameInput).toBeVisible({ timeout: 8000 });
    await nameInput.fill(tokenName);

    const generateBtn = page.getByRole('button', { name: 'Generate' });
    await expect(generateBtn).toBeEnabled({ timeout: 5000 });
    await generateBtn.click();

    // ── Step 2: One-time reveal appears ───────────────────────────────────────

    const warningText = page.getByText("Save this token now — it won't be shown again.");
    await expect(warningText).toBeVisible({ timeout: 8000 });

    // Read the raw token from the <code> element inside the reveal banner
    const tokenCode = page.locator('code').filter({ hasText: PAT_PREFIX }).first();
    await expect(tokenCode).toBeVisible({ timeout: 5000 });

    const rawToken = await tokenCode.innerText();
    expect(rawToken).toMatch(new RegExp(`^${PAT_PREFIX}`));

    // ── Step 3: Copy button works ──────────────────────────────────────────────

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    const copyBtn = page.getByRole('button', { name: 'Copy' });
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible({ timeout: 5000 });

    // ── Step 4: Token appears in the list ─────────────────────────────────────

    await expect(page.getByText(tokenName)).toBeVisible({ timeout: 5000 });

    // Confirm at least one Revoke button is present in the tokens section
    await expect(page.getByRole('button', { name: 'Revoke' }).first()).toBeVisible({
      timeout: 5000,
    });

    // ── Step 5: Token authenticates against the backend API ───────────────────

    // GET /v1/me/tokens — must return 200 with our token in the list
    const listResponse = await request.get(`${API_BASE}/me/tokens`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(listResponse.status()).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.tokens).toBeDefined();
    const ourToken = (listBody.tokens as Array<{ _id: string; name: string }>).find(
      (t) => t.name === tokenName,
    );
    expect(ourToken).toBeDefined();

    // GET /v1/health — basic connectivity check
    const healthResponse = await request.get(`${API_BASE.replace('/v1', '')}/health`);
    expect(healthResponse.status()).toBe(200);

    // ── Step 6: Revoke via API (tests DELETE endpoint) ────────────────────────

    const revokeResponse = await request.delete(`${API_BASE}/me/tokens/${ourToken!._id}`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(revokeResponse.status()).toBe(200);
    const revokeBody = await revokeResponse.json();
    expect(revokeBody.success).toBe(true);

    // Reload to confirm the UI removes the revoked token from the list
    await page.reload();
    await page.waitForSelector('text=API Tokens', { timeout: 10000 });
    await expect(page.getByText(tokenName)).not.toBeVisible({ timeout: 8000 });

    // ── Step 7: Revoked token is rejected by the API ──────────────────────────

    const revokedResponse = await request.get(`${API_BASE}/me/tokens`, {
      headers: { Authorization: `Bearer ${rawToken}` },
    });
    expect(revokedResponse.status()).toBe(401);
  });

  test('cannot generate a token without a name', async ({ page }) => {
    await login(page);
    await goToSettings(page);

    const apiTokensSection = page.getByText('API Tokens').first();
    await apiTokensSection.scrollIntoViewIfNeeded();

    const generateBtn = page.getByRole('button', { name: 'Generate' });
    await expect(generateBtn).toBeVisible({ timeout: 8000 });

    // Button must be disabled when the name input is empty
    await expect(generateBtn).toBeDisabled();
  });

  test('multiple tokens can be generated and are listed independently', async ({
    page,
    request,
  }) => {
    await login(page);
    await goToSettings(page);

    const apiTokensSection = page.getByText('API Tokens').first();
    await apiTokensSection.scrollIntoViewIfNeeded();

    const ts = Date.now();
    const nameA = `e2e-multi-A-${ts}`;
    const nameB = `e2e-multi-B-${ts}`;

    // Create token A
    const nameInput = page.getByPlaceholder('Token name (e.g. TimeHarbor)');
    await nameInput.fill(nameA);
    await page.getByRole('button', { name: 'Generate' }).click();

    const tokenCodeA = page.locator('code').filter({ hasText: PAT_PREFIX }).first();
    await expect(tokenCodeA).toBeVisible({ timeout: 8000 });
    const rawTokenA = await tokenCodeA.innerText();

    // Create token B
    await nameInput.fill(nameB);
    await page.getByRole('button', { name: 'Generate' }).click();

    const tokenCodeB = page.locator('code').filter({ hasText: PAT_PREFIX }).first();
    await expect(tokenCodeB).toBeVisible({ timeout: 8000 });
    const rawTokenB = await tokenCodeB.innerText();

    // Both tokens must appear in the list
    await expect(page.getByText(nameA)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(nameB)).toBeVisible({ timeout: 5000 });

    // Both tokens must independently authenticate
    const respA = await request.get(`${API_BASE}/me/tokens`, {
      headers: { Authorization: `Bearer ${rawTokenA}` },
    });
    expect(respA.status()).toBe(200);

    const respB = await request.get(`${API_BASE}/me/tokens`, {
      headers: { Authorization: `Bearer ${rawTokenB}` },
    });
    expect(respB.status()).toBe(200);

    // Cleanup — revoke both using API directly to avoid locator ambiguity
    const tokensResp = await request.get(`${API_BASE}/me/tokens`, {
      headers: { Authorization: `Bearer ${rawTokenA}` },
    });
    const tokensBody = await tokensResp.json();
    const allTokens = tokensBody.tokens as Array<{ _id: string; name: string }>;

    for (const t of allTokens.filter((t) => t.name === nameA || t.name === nameB)) {
      await request.delete(`${API_BASE}/me/tokens/${t._id}`, {
        headers: { Authorization: `Bearer ${rawTokenA}` },
      });
    }

    // Reload to confirm they're gone from the UI
    await page.reload();
    await page.waitForSelector('text=API Tokens', { timeout: 10000 });
    await expect(page.getByText(nameA)).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByText(nameB)).not.toBeVisible({ timeout: 8000 });
  });
});
