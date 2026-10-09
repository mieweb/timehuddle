import { expect, test, type Page } from '@playwright/test';
import {
  RUNS,
  apiTotals,
  collectApiCalls,
  newColdPage,
  report,
  reportEndpoints,
  sinceNavigationStart,
  trackWebSocket,
  type EndpointCost,
  type Sample,
} from './helpers/metrics';
import { PERF_USER } from './helpers/user';

// Point at a team with realistic data (members, tickets, clock events) to see real cost.
const TEAM_ID = process.env.PERF_DASH_TEAM_ID;
const DASHBOARD_PATH = `/app/dashboard${TEAM_ID ? `?teamId=${TEAM_ID}` : ''}`;

// The calls the dashboard overview waits on before it shows real numbers
// (`tickets_list` is what it called before the server-side summary).
const DASHBOARD_CALLS = [
  /\/api\/clock_teamStatus/,
  /\/api\/tickets_(dashboardSummary|list)/,
  /\/api\/timers_getTeamRunning/,
];

const BUDGET = { signInToDashboard: 2500, returningVisitToDashboard: 2500 };

/** Resolves once every dashboard data call for the team under test has answered. */
function dashboardData(page: Page) {
  return Promise.all(
    DASHBOARD_CALLS.map((call) =>
      page.waitForResponse(
        (res) =>
          call.test(res.url()) && (!TEAM_ID || (res.request().postData() ?? '').includes(TEAM_ID)),
      ),
    ),
  );
}

const hoursToday = (page: Page) => page.getByText('Hours today');

async function signIn(page: Page) {
  await page.getByRole('textbox', { name: 'Email address' }).fill(PERF_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PERF_USER.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function sample(runs: number, run: () => Promise<Sample>): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < runs; i++) samples.push(await run());
  return samples;
}

test.describe('dashboard', () => {
  test('sign in to dashboard', async ({ browser }) => {
    let costs: EndpointCost[] = [];
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser);
      const ws = trackWebSocket(page);
      // Signed out, a deep link shows the login form and returns here after sign-in.
      await page.goto(DASHBOARD_PATH);
      await page.getByRole('textbox', { name: 'Email address' }).waitFor();
      await page.waitForLoadState('networkidle');

      const mark = await sinceNavigationStart(page);
      const data = dashboardData(page);
      const start = Date.now();
      await signIn(page);
      await Promise.all([data, hoursToday(page).waitFor()]);
      const signInToDashboard = Date.now() - start;

      await page.waitForLoadState('networkidle');
      costs = await collectApiCalls(page, mark);
      await page.context().close();
      return { signInToDashboard, ...apiTotals(costs), ...ws() };
    });
    const m = report('dashboard-signin', samples);
    reportEndpoints('dashboard-signin-api', costs);
    expect.soft(m.signInToDashboard, 'sign in → dashboard').toBeLessThan(BUDGET.signInToDashboard);
  });

  test('returning visit (signed in, cold cache)', async ({ browser }) => {
    const setup = await newColdPage(browser);
    await setup.goto('/login');
    await signIn(setup);
    await setup.getByRole('navigation', { name: 'Main navigation' }).waitFor();
    const session = await setup.context().storageState();
    await setup.context().close();

    let costs: EndpointCost[] = [];
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser, session);
      const ws = trackWebSocket(page);
      const data = dashboardData(page);
      await page.goto(DASHBOARD_PATH);
      await Promise.all([data, hoursToday(page).waitFor()]);
      const visitToDashboard = await sinceNavigationStart(page);

      await page.waitForLoadState('networkidle');
      costs = await collectApiCalls(page);
      await page.context().close();
      return { visitToDashboard, ...apiTotals(costs), ...ws() };
    });
    const m = report('dashboard-returning', samples);
    reportEndpoints('dashboard-returning-api', costs);
    expect
      .soft(m.visitToDashboard, 'visit → dashboard')
      .toBeLessThan(BUDGET.returningVisitToDashboard);
  });
});
