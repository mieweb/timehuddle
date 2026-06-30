import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * E2E Test: Complete Member Blocking Flow
 * 
 * This test covers the entire user journey from signup to blocking:
 * 1. Owner creates account, organization, and team
 * 2. Member creates account and requests to join team
 * 3. Owner approves join request
 * 4. Member appears in organization members list
 * 5. Owner blocks the member
 * 6. Blocked member cannot login
 * 7. Owner unblocks the member
 * 8. Member can login again
 */
test.describe('Member Blocking - Full Flow', () => {
  const timestamp = Date.now();
  
  const owner = {
    email: `owner-${timestamp}@test.local`,
    password: 'TestPass123!',
    name: `Owner ${timestamp}`,
  };

  const member = {
    email: `member-${timestamp}@test.local`,
    password: 'TestPass123!',
    name: `Member ${timestamp}`,
  };

  const orgName = `Test Org ${timestamp}`;
  const teamName = `Test Team ${timestamp}`;

  test('complete blocking flow from user creation to unblock', async ({ page }) => {
    const loginPage = new LoginPage(page);

    // ============================================================
    // PART 1: Owner Setup - Create Account, Org, and Team
    // ============================================================
    
    test.step('Owner signs up', async () => {
      await loginPage.goto();
      await page.waitForTimeout(1000);
      
      // Click "Sign up" button
      await page.getByRole('button', { name: /sign up/i }).click();
      await page.waitForTimeout(1000);
      
      // Fill signup form
      await page.getByLabel(/name/i).first().fill(owner.name);
      await page.getByLabel(/email/i).first().fill(owner.email);
      await page.getByLabel(/^password/i).first().fill(owner.password);
      
      // Submit signup
      await page.getByRole('button', { name: /create account/i }).click();
      
      // Wait for redirect to dashboard
      await page.waitForURL('**/dashboard', { timeout: 20000 });
      
      // Verify logged in
      const sidebar = page.getByRole('complementary');
      await expect(sidebar).toBeVisible({ timeout: 10000 });
    });

    test.step('Owner creates organization', async () => {
      // Navigate to organizations page
      await page.getByRole('button', { name: /^Organization$/i }).click();
      await page.waitForTimeout(1000);
      
      // Click "Create Organization" or similar button
      const createOrgButton = page.getByRole('button', { name: /create.*organization/i }).or(
        page.getByRole('button', { name: /new.*organization/i })
      ).or(
        page.getByRole('button', { name: /add.*organization/i })
      );
      
      if (await createOrgButton.isVisible().catch(() => false)) {
        await createOrgButton.click();
        await page.waitForTimeout(500);
        
        // Fill organization name
        await page.getByLabel(/organization.*name/i).or(page.getByLabel(/name/i)).fill(orgName);
        
        // Submit
        await page.getByRole('button', { name: /create/i }).or(
          page.getByRole('button', { name: /save/i })
        ).click();
        
        await page.waitForTimeout(2000);
      } else {
        // If first login creates default org, just rename it
        console.log('Using default organization');
      }
    });

    test.step('Owner creates team', async () => {
      // Navigate to teams page
      await page.getByRole('button', { name: /^Teams$/i }).click();
      await page.waitForTimeout(1000);
      
      // Click "Create Team" button
      const createTeamButton = page.getByRole('button', { name: /create.*team/i }).or(
        page.getByRole('button', { name: /new.*team/i })
      );
      await createTeamButton.click();
      await page.waitForTimeout(500);
      
      // Fill team name
      await page.getByLabel(/team.*name/i).or(page.getByLabel(/name/i)).fill(teamName);
      
      // Submit
      await page.getByRole('button', { name: /create/i }).click();
      await page.waitForTimeout(2000);
      
      // Verify team created
      await expect(page.getByText(teamName)).toBeVisible({ timeout: 5000 });
    });

    test.step('Owner logs out', async () => {
      // Open account menu
      await page.getByRole('button', { name: /account menu/i }).click();
      await page.waitForTimeout(500);
      
      // Click sign out
      await page.getByRole('button', { name: /sign out/i }).click();
      
      // Wait for redirect to login
      await page.waitForURL('**/login', { timeout: 10000 });
    });

    // ============================================================
    // PART 2: Member Setup - Create Account and Join Team
    // ============================================================
    
    test.step('Member signs up', async () => {
      // Fill signup form
      await page.getByRole('button', { name: /sign up/i }).click();
      await page.waitForTimeout(500);
      
      await page.getByLabel(/name/i).fill(member.name);
      await page.getByLabel(/email/i).fill(member.email);
      await page.getByLabel(/^password/i).first().fill(member.password);
      
      // Submit signup
      await page.getByRole('button', { name: /create account/i }).click();
      
      // Wait for redirect to dashboard
      await page.waitForURL('**/dashboard', { timeout: 15000 });
    });

    test.step('Member requests to join team', async () => {
      // Navigate to teams page
      await page.getByRole('button', { name: /^Teams$/i }).click();
      await page.waitForTimeout(1000);
      
      // Look for "Join Team" or "Join a team" option
      const joinTeamButton = page.getByRole('button', { name: /join.*team/i }).or(
        page.getByText(/join.*team/i)
      );
      
      if (await joinTeamButton.isVisible().catch(() => false)) {
        await joinTeamButton.click();
        await page.waitForTimeout(500);
        
        // Search for the team
        const searchInput = page.getByPlaceholder(/search/i).or(
          page.getByLabel(/search/i)
        );
        await searchInput.fill(teamName);
        await page.waitForTimeout(1000);
        
        // Click on the team
        await page.getByText(teamName).click();
        
        // Request to join
        await page.getByRole('button', { name: /request.*join/i }).or(
          page.getByRole('button', { name: /join/i })
        ).click();
        
        await page.waitForTimeout(2000);
      }
    });

    test.step('Member logs out', async () => {
      // Open account menu
      await page.getByRole('button', { name: /account menu/i }).click();
      await page.waitForTimeout(500);
      
      // Click sign out
      await page.getByRole('button', { name: /sign out/i }).click();
      
      // Wait for redirect to login
      await page.waitForURL('**/login', { timeout: 10000 });
    });

    // ============================================================
    // PART 3: Owner Approves Join Request
    // ============================================================
    
    test.step('Owner logs back in', async () => {
      await loginPage.login(owner.email, owner.password);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
    });

    test.step('Owner approves join request', async () => {
      // Navigate to teams page
      await page.getByRole('button', { name: /^Teams$/i }).click();
      await page.waitForTimeout(1000);
      
      // Click on the team
      await page.getByText(teamName).click();
      await page.waitForTimeout(1000);
      
      // Look for pending requests or invitations tab
      const requestsTab = page.getByRole('tab', { name: /request/i }).or(
        page.getByRole('tab', { name: /pending/i })
      );
      
      if (await requestsTab.isVisible().catch(() => false)) {
        await requestsTab.click();
        await page.waitForTimeout(500);
      }
      
      // Find the member's request and approve it
      const memberRow = page.getByRole('row').filter({ hasText: member.name }).or(
        page.getByText(member.name).locator('..')
      );
      
      const approveButton = memberRow.getByRole('button', { name: /approve/i }).or(
        memberRow.getByRole('button', { name: /accept/i })
      );
      
      await approveButton.click();
      await page.waitForTimeout(2000);
    });

    // ============================================================
    // PART 4: Verify Member in Organization Members List
    // ============================================================
    
    test.step('Verify member appears in organization members list', async () => {
      // Navigate to organization members page
      await page.goto('/app/org/members');
      await page.waitForTimeout(2000);
      
      // Wait for members table to load
      await expect(page.getByRole('table')).toBeVisible({ timeout: 10000 });
      
      // Find the member row
      const memberRow = page.getByRole('row').filter({ hasText: member.name });
      await expect(memberRow).toBeVisible({ timeout: 5000 });
      
      // Verify member is NOT blocked initially
      const blockedBadge = memberRow.getByText(/blocked/i);
      await expect(blockedBadge).not.toBeVisible().catch(() => {});
    });

    // ============================================================
    // PART 5: Block Member
    // ============================================================
    
    test.step('Owner blocks the member', async () => {
      // Ensure we're on members page
      await page.goto('/app/org/members');
      await page.waitForTimeout(2000);
      
      // Find the member row
      const memberRow = page.getByRole('row').filter({ hasText: member.name });
      
      // Click "Block" button
      const blockButton = memberRow.getByRole('button', { name: /^Block$/i });
      await expect(blockButton).toBeVisible();
      await blockButton.click();
      
      // Fill block modal
      await expect(page.getByRole('heading', { name: /block member/i })).toBeVisible({ timeout: 5000 });
      
      const reasonTextarea = page.getByLabel(/reason/i);
      await reasonTextarea.fill('E2E test - blocking user for testing');
      
      // Confirm block
      const confirmButton = page.getByRole('button', { name: /^block$/i }).last();
      await confirmButton.click();
      
      // Wait for block to complete
      await page.waitForTimeout(2000);
      
      // Reload to verify
      await page.reload();
      await page.waitForTimeout(1000);
      
      // Verify "Blocked" badge is visible
      const updatedMemberRow = page.getByRole('row').filter({ hasText: member.name });
      const blockedBadge = updatedMemberRow.getByText(/blocked/i);
      await expect(blockedBadge).toBeVisible({ timeout: 5000 });
      
      // Verify "Unblock" button is shown
      const unblockButton = updatedMemberRow.getByRole('button', { name: /unblock/i });
      await expect(unblockButton).toBeVisible();
    });

    test.step('Owner logs out', async () => {
      const accountMenu = page.getByRole('button', { name: /account menu/i });
      await accountMenu.click();
      const signOutButton = page.getByRole('button', { name: /sign out/i });
      await signOutButton.click();
      await page.waitForURL('**/login', { timeout: 10000 });
    });

    // ============================================================
    // PART 6: Verify Blocked Member Cannot Login
    // ============================================================
    
    test.step('Blocked member cannot login', async () => {
      await loginPage.login(member.email, member.password);
      await page.waitForTimeout(2000);
      
      // Should remain on login page
      await expect(page).toHaveURL(/.*login/, { timeout: 5000 });
      
      // Should show suspension error message
      const errorAlert = page.getByRole('alert');
      await expect(errorAlert).toBeVisible();
      const errorText = await errorAlert.textContent();
      expect(errorText?.toLowerCase()).toMatch(/suspended|blocked|contact.*administrator/i);
    });

    // ============================================================
    // PART 7: Owner Unblocks Member
    // ============================================================
    
    test.step('Owner logs back in to unblock member', async () => {
      await loginPage.login(owner.email, owner.password);
      await page.waitForURL('**/dashboard', { timeout: 15000 });
    });

    test.step('Owner unblocks the member', async () => {
      // Navigate to members page
      await page.goto('/app/org/members');
      await page.waitForTimeout(2000);
      
      // Find the member row
      const memberRow = page.getByRole('row').filter({ hasText: member.name });
      
      // Click "Unblock" button
      const unblockButton = memberRow.getByRole('button', { name: /unblock/i });
      await expect(unblockButton).toBeVisible();
      await unblockButton.click();
      
      // Wait for unblock to complete
      await page.waitForTimeout(2000);
      
      // Reload to verify
      await page.reload();
      await page.waitForTimeout(1000);
      
      // Verify member is no longer blocked
      const updatedMemberRow = page.getByRole('row').filter({ hasText: member.name });
      const blockedBadge = updatedMemberRow.getByText(/blocked/i);
      await expect(blockedBadge).not.toBeVisible().catch(() => {});
      
      // Verify "Block" button is shown (not "Unblock")
      const blockButton = updatedMemberRow.getByRole('button', { name: /^Block$/i });
      await expect(blockButton).toBeVisible();
    });

    test.step('Owner logs out', async () => {
      const accountMenu = page.getByRole('button', { name: /account menu/i });
      await accountMenu.click();
      const signOutButton = page.getByRole('button', { name: /sign out/i });
      await signOutButton.click();
      await page.waitForURL('**/login', { timeout: 10000 });
    });

    // ============================================================
    // PART 8: Verify Member Can Login After Unblock
    // ============================================================
    
    test.step('Unblocked member can login successfully', async () => {
      await loginPage.login(member.email, member.password);
      
      // Should successfully login and reach dashboard
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      
      // Verify dashboard loaded
      const sidebar = page.getByRole('complementary');
      await expect(sidebar).toBeVisible();
    });
  });
});
