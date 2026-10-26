import { test, type Locator, type Page } from '@playwright/test';
import {
  RUNS,
  apiTotals,
  collectJs,
  keepMedianVideo,
  newColdPage,
  report,
  reportEndpoints,
  sinceNavigationStart,
  trackApiCalls,
  trackWebSocket,
  withinBudget,
  type ApiCosts,
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

async function fillCredentials(page: Page) {
  await page.getByRole('textbox', { name: 'Email address' }).fill(PERF_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PERF_USER.password);
}

const submitSignIn = (page: Page) =>
  page.getByRole('button', { name: 'Sign in', exact: true }).click();

async function signIn(page: Page) {
  await fillCredentials(page);
  await submitSignIn(page);
}

async function sample(runs: number, run: () => Promise<Sample>): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < runs; i++) samples.push(await run());
  return samples;
}

/**
 * Resolves once every data call has succeeded and its body has finished downloading
 * (`waitForResponse` alone resolves on headers).
 */
function dataResponses(page: Page, calls: RegExp[]) {
  return Promise.all(
    calls.map((call) =>
      page.waitForResponse((res) => call.test(res.url()) && res.ok()).then((res) => res.finished()),
    ),
  );
}

/** Waits for the data to be on screen: the ready element, then the next painted frame. */
async function dataOnScreen(page: Page, data: Promise<unknown>, ready: Locator) {
  await Promise.all([data, ready.first().waitFor()]);
  // The page renders a finished response a moment later; let that frame paint.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve))),
  );
}

/** Registers "sign in to <page>" and "returning visit to <page>" perf tests. */
export function definePageFlowTests({ name, path, dataCalls, ready, budgetMs }: PageFlowConfig) {
  test.describe(name, () => {
    test(`sign in to ${name}`, async ({ browser }) => {
      let costs: ApiCosts = { endpoints: [], duplicateCalls: 0 };
      const videos: (string | undefined)[] = [];
      const samples = await sample(RUNS, async () => {
        const page = await newColdPage(browser, undefined, { recordVideo: true });
        const ws = trackWebSocket(page);
        const api = trackApiCalls(page);
        // Signed out, a deep link shows the login form and returns here after sign-in.
        await page.goto(path);
        await page.getByRole('textbox', { name: 'Email address' }).waitFor();
        await page.waitForLoadState('networkidle');

        const mark = await sinceNavigationStart(page);
        api.reset();
        const data = dataResponses(page, dataCalls);
        // Time from the Sign in click, not from Playwright typing the credentials.
        await fillCredentials(page);
        const start = Date.now();
        await submitSignIn(page);
        await dataOnScreen(page, data, ready(page));
        const signInToReady = Date.now() - start;

        await page.waitForLoadState('networkidle');
        costs = await api.collect();
        const js = await collectJs(page, mark);
        const video = page.video();
        await page.context().close();
        videos.push(await video?.path());
        return { signInToReady, ...apiTotals(costs), ...ws(), ...js };
      });
      const m = report(`${name}-signin`, samples);
      reportEndpoints(`${name}-signin-api`, costs.endpoints);
      keepMedianVideo(`${name}-signin`, 'signInToReady', samples, videos);
      withinBudget(m.signInToReady, budgetMs, `sign in → ${name}`);
    });

    test(`returning visit to ${name} (signed in, cold cache)`, async ({ browser }) => {
      const setup = await newColdPage(browser);
      await setup.goto('/login');
      await signIn(setup);
      await setup.getByRole('navigation', { name: 'Main navigation' }).waitFor();
      const session = await setup.context().storageState();
      await setup.context().close();

      let costs: ApiCosts = { endpoints: [], duplicateCalls: 0 };
      const videos: (string | undefined)[] = [];
      const samples = await sample(RUNS, async () => {
        const page = await newColdPage(browser, session, { recordVideo: true });
        const ws = trackWebSocket(page);
        const api = trackApiCalls(page);
        const data = dataResponses(page, dataCalls);
        await page.goto(path);
        await dataOnScreen(page, data, ready(page));
        const visitToReady = await sinceNavigationStart(page);

        await page.waitForLoadState('networkidle');
        costs = await api.collect();
        const js = await collectJs(page);
        const video = page.video();
        await page.context().close();
        videos.push(await video?.path());
        return { visitToReady, ...apiTotals(costs), ...ws(), ...js };
      });
      const m = report(`${name}-returning`, samples);
      reportEndpoints(`${name}-returning-api`, costs.endpoints);
      keepMedianVideo(`${name}-returning`, 'visitToReady', samples, videos);
      withinBudget(m.visitToReady, budgetMs, `visit → ${name}`);
    });
  });
}
