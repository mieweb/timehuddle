/**
 * Plan-First Clock Flow E2E Tests
 *
 * Comprehensive test suite for the plan-first clock flow feature:
 *
 * 1. User creates a team
 * 2. User goes to team settings and enables "Require a plan for every clock-in/out"
 * 3. When enabled: User must write a plan before clocking in, and add a wrap-up before clocking out
 * 4. When disabled: User can clock in/out normally without posting to huddle
 * 5. Posts created via clock flow appear in the huddle feed
 * 6. Wrap-ups are appended to the same post
 *
 * Scenarios tested:
 *   - Plan requirement disabled (default) — can clock in/out freely
 *   - Plan requirement enabled — plan gate blocks clock in
 *   - Post plan → clock in → post wrap-up → clock out → verify in huddle
 */
import { test, expect } from '@playwright/test';
import { TeamsPage } from '../pages/TeamsPage';
import { TeamSettingsPage } from '../pages/TeamSettingsPage';
import { ClockPage } from '../pages/ClockPage';
import { HuddlePage } from '../pages/HuddlePage';
import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Plan-First Clock Flow', () => {
  let teamsPage: TeamsPage;
  let teamSettingsPage: TeamSettingsPage;
  let clockPage: ClockPage;
  let huddlePage: HuddlePage;

  test.beforeEach(async ({ page }) => {
    teamsPage = new TeamsPage(page);
    teamSettingsPage = new TeamSettingsPage(page);
    clockPage = new ClockPage(page);
    huddlePage = new HuddlePage(page);

    // Login as an owner who can create teams
    await loginAs(page, TEST_USERS.owner1);
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15000 });

    // Start every test from a known clock state — see ensureClockedOut().
    await clockPage.ensureClockedOut();
  });

  test('should create a team with unique name', async ({ page }) => {
    // Navigate to teams page
    await teamsPage.goto();
    await expect(teamsPage.heading).toBeVisible();

    // Create team
    const teamName = `PlanFlowTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').waitFor({ state: 'visible' });
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Verify team appears in list
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible({ timeout: 10000 });
  });

  test('should toggle plan requirement in team settings', async ({ page }) => {
    // Create a team first
    await teamsPage.goto();
    const teamName = `SettingsTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Open team settings by clicking the gear icon button
    const settingsButton = page.getByRole('button', { name: 'Team Settings' }).first();
    await settingsButton.click({ timeout: 5000 });

    // Wait for modal to appear
    await teamSettingsPage.waitForModal();

    // Verify requirement is disabled by default
    const initialState = await teamSettingsPage.isRequirePlanEnabled();
    expect(initialState).toBe(false);

    // Enable the requirement
    await teamSettingsPage.enableRequirePlan();
    const enabledState = await teamSettingsPage.isRequirePlanEnabled();
    expect(enabledState).toBe(true);

    // Disable it again
    await teamSettingsPage.disableRequirePlan();
    const disabledState = await teamSettingsPage.isRequirePlanEnabled();
    expect(disabledState).toBe(false);

    // Enable it one more time for the final state
    await teamSettingsPage.enableRequirePlan();
    const finalState = await teamSettingsPage.isRequirePlanEnabled();
    expect(finalState).toBe(true);

    // Close modal
    await teamSettingsPage.close();
  });

  test('when plan requirement DISABLED: user can clock in/out without posting', async ({
    page,
  }) => {
    // Create team with plan requirement disabled (default)
    await teamsPage.goto();
    const teamName = `NoReqTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Navigate to clock page
    await clockPage.goto();

    // Verify plan gate is NOT visible (no plan requirement)
    const isPlanGateVisible = await clockPage.isPlanGateVisible();
    expect(isPlanGateVisible).toBe(false);

    // Clock in should be available
    const clockInButtonVisible = await clockPage.clockInButton.isVisible();
    expect(clockInButtonVisible).toBe(true);

    // Clock in
    await clockPage.clockIn();

    // Verify we're clocked in
    const isClockedIn = await clockPage.isClockedIn();
    expect(isClockedIn).toBe(true);

    // Clock out
    await clockPage.clockOut();

    // Verify we're clocked out
    const stillClockedIn = await clockPage.isClockedIn();
    expect(stillClockedIn).toBe(false);
  });

  test('when plan requirement ENABLED: plan gate blocks clock in', async ({ page }) => {
    // Create team
    await teamsPage.goto();
    const teamName = `GateTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Open team settings and enable plan requirement
    const settingsButton = page.getByRole('button', { name: 'Team Settings' }).first();
    await settingsButton.click({ timeout: 5000 });

    await teamSettingsPage.waitForModal();
    await teamSettingsPage.enableRequirePlan();
    await teamSettingsPage.close();

    // Navigate to clock page
    await clockPage.goto();

    // Verify plan gate message is visible
    const isPlanGateVisible = await clockPage.isPlanGateVisible();
    expect(isPlanGateVisible).toBe(true);

    // The plain "Clock in" button is replaced by the plan composer, so a bare
    // clock-in is impossible until a plan is posted.
    await expect(clockPage.postPlanAndClockInButton).toBeVisible();
    await expect(clockPage.clockInButton).toBeHidden();
  });

  test('complete plan-first flow: post plan → clock in → post wrap-up → clock out', async ({
    page,
  }) => {
    test.slow();
    // Create team
    await teamsPage.goto();
    const teamName = `FlowTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Open team settings and enable plan requirement
    const settingsButton = page.getByRole('button', { name: 'Team Settings' }).first();
    await settingsButton.click({ timeout: 5000 });

    await teamSettingsPage.waitForModal();
    await teamSettingsPage.enableRequirePlan();
    await teamSettingsPage.close();

    // Navigate to clock page
    await clockPage.goto();

    // Type and post plan
    const planText = `Complete project documentation and code review - ${Date.now()}`;
    await clockPage.typePlan(planText);

    // Post plan and clock in
    await clockPage.postPlanAndClockIn();

    // Verify clocked in state
    const isClockedIn = await clockPage.isClockedIn();
    expect(isClockedIn).toBe(true);

    // Type wrap-up
    const wrapUpText = `Finished documentation, started code review, will continue tomorrow`;
    await clockPage.typeWrapUp(wrapUpText);

    // Post wrap-up and clock out
    await clockPage.postWrapUpAndClockOut();

    // Verify clocked out
    const isClockedOut = !(await clockPage.isClockedIn());
    expect(isClockedOut).toBe(true);

    // Navigate to huddle to verify post and wrap-up are there. hasPost retries
    // on its own — DDP/WebSocket feed updates can arrive after navigation.
    await huddlePage.goto();
    expect(await huddlePage.hasPost(planText), 'plan text in the huddle feed').toBe(true);
    expect(await huddlePage.hasPost(wrapUpText), 'wrap-up text in the huddle feed').toBe(true);
  });

  test('should handle disabling/re-enabling requirement during session', async ({ page }) => {
    // Heaviest flow in this file (full clock cycle + settings toggle + repeated
    // hard navigations) on top of a beforeEach login that can hit the ~46s DDP
    // cold-start retry path — triple the default budget so a warming backend
    // doesn't clip the test at 45s mid-hook.
    test.slow();

    // Create team
    await teamsPage.goto();
    const teamName = `ToggleTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Navigate to clock page (requirement disabled by default)
    await clockPage.goto();

    // Verify no plan gate
    const noPlanGate = !(await clockPage.isPlanGateVisible());
    expect(noPlanGate).toBe(true);

    // Clock in without plan
    await clockPage.clockIn();
    expect(await clockPage.isClockedIn()).toBe(true);

    // Clock out
    await clockPage.clockOut();
    expect(await clockPage.isClockedIn()).toBe(false);

    // Now enable the requirement in settings
    await teamsPage.goto();
    const settingsButton = page.getByRole('button', { name: 'Team Settings' }).first();
    await settingsButton.click({ timeout: 5000 });

    await teamSettingsPage.waitForModal();
    await teamSettingsPage.enableRequirePlan();
    await teamSettingsPage.close();

    // Go back to clock page
    await clockPage.goto();

    // Now plan gate should be visible
    const planGateNowVisible = await clockPage.isPlanGateVisible();
    expect(planGateNowVisible).toBe(true);
  });

  test('should verify wrap-up is appended to same post (not create new post)', async ({ page }) => {
    test.slow();
    // Create team
    await teamsPage.goto();
    const teamName = `AppendTest-${Date.now()}`;
    await page.getByRole('button', { name: 'Create Team' }).click();
    await page.getByPlaceholder('Team name').fill(teamName);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Wait for and close the "Team Created!" modal
    await page.getByRole('button', { name: 'Done' }).click({ timeout: 10000 });

    // Enable plan requirement
    const settingsButton = page.getByRole('button', { name: 'Team Settings' }).first();
    await settingsButton.click({ timeout: 5000 });

    await teamSettingsPage.waitForModal();
    await teamSettingsPage.enableRequirePlan();
    await teamSettingsPage.close();

    // Complete clock flow
    await clockPage.goto();

    const uniqueMarker = `unique-session-${Date.now()}`;
    const planText = `Morning standup - ${uniqueMarker}`;
    const wrapUpText = `Tasks completed today - ${uniqueMarker}`;

    await clockPage.typePlan(planText);
    await clockPage.postPlanAndClockIn();

    // Add wrap-up
    await clockPage.typeWrapUp(wrapUpText);
    await clockPage.postWrapUpAndClockOut();

    // Navigate to huddle
    await huddlePage.goto();

    // One post carries both halves — the wrap-up was appended to the plan.
    const postWithMarker = await huddlePage.getPostText(uniqueMarker);
    expect(postWithMarker).toContain(planText);
    expect(postWithMarker).toContain(wrapUpText);
  });
});
