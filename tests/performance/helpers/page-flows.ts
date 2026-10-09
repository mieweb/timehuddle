import { test, type Locator, type Page } from '@playwright/test';
import {
  RUNS,
  apiTotals,
  collectApiCalls,
  collectJs,
  newColdPage,
  report,
  reportEndpoints,
  sinceNavigationStart,
  trackWebSocket,
  withinBudget,
  type EndpointCost,
  type Sample,
} from './metrics';
import { PERF_USER } from './user';

export interface PageFlowConfig {
  /** Result-file prefix and test title, e.g. "teams". */
  name: string;
  /** Deep link to the page, including any team scope. */
  path: string;
  /** API calls whose responses the page waits on before it shows real data. */
  dataCalls: RegExp[];
  /** Something on screen that only exists once the data has rendered. */
  ready: (page: Page) => Locator;
  /** Soft budget (ms) for both flows. */
  budgetMs: number;
}

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

/** Resolves once every data call has answered at least once. */
function dataResponses(page: Page, calls: RegExp[]) {
  return Promise.all(calls.map((call) => page.waitForResponse((res) => call.test(res.url()))));
}

/** Registers "sign in to <page>" and "returning visit to <page>" perf tests. */
export function definePageFlowTests({ name, path, dataCalls, ready, budgetMs }: PageFlowConfig) {
  test.describe(name, () => {
    test(`sign in to ${name}`, async ({ browser }) => {
      let costs: EndpointCost[] = [];
      const samples = await sample(RUNS, async () => {
        const page = await newColdPage(browser);
        const ws = trackWebSocket(page);
        // Signed out, a deep link shows the login form and returns here after sign-in.
        await page.goto(path);
        await page.getByRole('textbox', { name: 'Email address' }).waitFor();
        await page.waitForLoadState('networkidle');

        const mark = await sinceNavigationStart(page);
        const data = dataResponses(page, dataCalls);
        const start = Date.now();
        await signIn(page);
        await Promise.all([data, ready(page).first().waitFor()]);
        const signInToReady = Date.now() - start;

        await page.waitForLoadState('networkidle');
        costs = await collectApiCalls(page, mark);
        const js = await collectJs(page, mark);
        await page.context().close();
        return { signInToReady, ...apiTotals(costs), ...ws(), ...js };
      });
      const m = report(`${name}-signin`, samples);
      reportEndpoints(`${name}-signin-api`, costs);
      withinBudget(m.signInToReady, budgetMs, `sign in → ${name}`);
    });

    test(`returning visit to ${name} (signed in, cold cache)`, async ({ browser }) => {
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
        const data = dataResponses(page, dataCalls);
        await page.goto(path);
        await Promise.all([data, ready(page).first().waitFor()]);
        const visitToReady = await sinceNavigationStart(page);

        await page.waitForLoadState('networkidle');
        costs = await collectApiCalls(page);
        const js = await collectJs(page);
        await page.context().close();
        return { visitToReady, ...apiTotals(costs), ...ws(), ...js };
      });
      const m = report(`${name}-returning`, samples);
      reportEndpoints(`${name}-returning-api`, costs);
      withinBudget(m.visitToReady, budgetMs, `visit → ${name}`);
    });
  });
}
