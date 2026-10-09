import { test, type Page } from '@playwright/test';
import {
  RUNS,
  collectLoadMetrics,
  newColdPage,
  report,
  sinceNavigationStart,
  withinBudget,
  type Sample,
} from './helpers/metrics';
import { PERF_USER } from './helpers/user';

const LOGIN_PATH = process.env.PERF_LOGIN_PATH ?? '/login';
const SIGNUP_PATH = `${LOGIN_PATH}?mode=signup`;

// Core Web Vitals "good" thresholds; soft so every metric is reported on failure.
const BUDGET = {
  fcp: 1800,
  lcp: 2500,
  cls: 0.1,
  formReady: 2500,
  loginToShell: 2000,
  signupToDialog: 2500,
};

const loginHeading = (page: Page) => page.getByRole('heading', { name: 'Sign in to your account' });
const signupHeading = (page: Page) => page.getByRole('heading', { name: 'Create your account' });
const appShell = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

async function sample(runs: number, run: () => Promise<Sample>): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (let i = 0; i < runs; i++) samples.push(await run());
  return samples;
}

/** Load a page and record vitals plus time until its form is usable. */
async function measurePageLoad(
  page: Page,
  url: string,
  heading: (p: Page) => ReturnType<Page['getByRole']>,
) {
  await page.goto(url);
  await heading(page).waitFor();
  await page.getByRole('textbox', { name: 'Email address' }).waitFor();
  const formReady = await sinceNavigationStart(page);
  return { ...(await collectLoadMetrics(page)), formReady };
}

test.beforeAll(async ({ browser }) => {
  // A fresh environment (PR preview) has no perf account; PERF_PROVISION=1 creates it.
  if (!process.env.PERF_PROVISION) return;
  const page = await newColdPage(browser);
  await page.goto(SIGNUP_PATH);
  await signupHeading(page).waitFor();
  await page.getByRole('textbox', { name: 'First name' }).fill('Perf');
  await page.getByRole('textbox', { name: 'Last name' }).fill('Bot');
  await page.getByRole('textbox', { name: 'Email address' }).fill(PERF_USER.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PERF_USER.password);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(PERF_USER.password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Username Required' });
  await dialog.getByRole('button', { name: 'Claim username' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.context().close();
});

test.describe('login page', () => {
  test('cold load', async ({ browser }) => {
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser);
      const metrics = await measurePageLoad(page, LOGIN_PATH, loginHeading);
      await page.context().close();
      return metrics;
    });
    const m = report('login-page-cold', samples);
    withinBudget(m.fcp, BUDGET.fcp, 'FCP');
    withinBudget(m.lcp, BUDGET.lcp, 'LCP');
    withinBudget(m.cls, BUDGET.cls, 'CLS');
    withinBudget(m.formReady, BUDGET.formReady, 'form ready');
  });

  test('warm load (repeat visit)', async ({ browser }) => {
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser);
      await measurePageLoad(page, LOGIN_PATH, loginHeading);
      await page.reload();
      await loginHeading(page).waitFor();
      const metrics = await collectLoadMetrics(page);
      await page.context().close();
      return metrics;
    });
    report('login-page-warm', samples);
  });

  test('sign in: submit to app shell', async ({ browser }) => {
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser);
      const load = await measurePageLoad(page, LOGIN_PATH, loginHeading);
      await page.getByRole('textbox', { name: 'Email address' }).fill(PERF_USER.email);
      await page.getByRole('textbox', { name: 'Password' }).fill(PERF_USER.password);

      const start = Date.now();
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await appShell(page).waitFor();
      const loginToShell = Date.now() - start;
      const visitToShell = await sinceNavigationStart(page);
      await page.context().close();
      return { formReady: load.formReady, loginToShell, visitToShell };
    });
    const m = report('login-flow', samples);
    withinBudget(m.loginToShell, BUDGET.loginToShell, 'submit → app shell');
  });
});

test.describe('signup page', () => {
  test('cold load', async ({ browser }) => {
    const samples = await sample(RUNS, async () => {
      const page = await newColdPage(browser);
      const metrics = await measurePageLoad(page, SIGNUP_PATH, signupHeading);
      await page.context().close();
      return metrics;
    });
    const m = report('signup-page-cold', samples);
    withinBudget(m.fcp, BUDGET.fcp, 'FCP');
    withinBudget(m.lcp, BUDGET.lcp, 'LCP');
    withinBudget(m.cls, BUDGET.cls, 'CLS');
    withinBudget(m.formReady, BUDGET.formReady, 'form ready');
  });

  // Every sample creates a real account (no delete API): one by default, raise PERF_SIGNUP_RUNS locally.
  test('sign up: submit to username prompt', async ({ browser }) => {
    const samples = await sample(Number(process.env.PERF_SIGNUP_RUNS ?? 1), async () => {
      const page = await newColdPage(browser);
      const load = await measurePageLoad(page, SIGNUP_PATH, signupHeading);
      const unique = `perf-signup-${Date.now()}@test.local`;
      await page.getByRole('textbox', { name: 'First name' }).fill('Perf');
      await page.getByRole('textbox', { name: 'Last name' }).fill('Signup');
      await page.getByRole('textbox', { name: 'Email address' }).fill(unique);
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PERF_USER.password);
      await page.getByRole('textbox', { name: 'Confirm password' }).fill(PERF_USER.password);

      const start = Date.now();
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByRole('dialog', { name: 'Username Required' }).waitFor();
      const signupToDialog = Date.now() - start;
      await page.context().close();
      return { formReady: load.formReady, signupToDialog };
    });

    const m = report('signup-flow', samples);
    withinBudget(m.signupToDialog, BUDGET.signupToDialog, 'submit → username prompt');
  });
});
