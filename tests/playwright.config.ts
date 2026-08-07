import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Migration tests are one-time processes — excluded from the regular suite.
  // Run them on-demand: npx playwright test -c tests/playwright.config.ts --ignore-snapshots tests/e2e/auth-migration.spec.ts tests/e2e/better-auth-migration.spec.ts
  testIgnore: process.env.RUN_MIGRATION_TESTS
    ? []
    : ['**/auth-migration.spec.ts', '**/better-auth-migration.spec.ts'],

  // Runs once before all workers — provisions the @test.local seed users so
  // the suite is hermetic and safe to re-run against a fresh dev DB.
  globalSetup: require.resolve('./e2e/global-setup.ts'),

  // Runs once after all workers finish — removes test users and data.
  // Set SKIP_CLEANUP=1 to keep test data (e.g. in production or for debugging).
  globalTeardown: require.resolve('./e2e/global-teardown.ts'),

  // Run tests serially — one test after another to avoid DB contention
  fullyParallel: false,

  // Retry failed tests up to twice — the sequential suite is auth- and
  // backend-timing sensitive; a single retry occasionally isn't enough for
  // transient session/DDP hiccups on a warming backend.
  retries: 2,

  // Single worker — sequential execution
  workers: 1,

  // Reporter
  reporter: [['list'], ['html', { outputFolder: '../playwright-report' }]],

  // Shared settings for all tests
  use: {
    // Base URL for tests — dedicated e2e frontend (see webServer below),
    // isolated from the pm2-managed dev frontend on :3000 so test runs never
    // touch the dev database.
    baseURL: 'http://localhost:3002',

    // Browser settings
    ...devices['Desktop Chrome'],

    // Slow down execution for debugging (set PWSLOWMO env var)
    launchOptions: {
      slowMo: process.env.PWSLOWMO ? parseInt(process.env.PWSLOWMO, 10) : 0,
    },

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: process.env.PWVIDEO ? 'on' : 'retain-on-failure',

    // Trace on first retry
    trace: 'on-first-retry',

    // Grant clipboard write permission by default — the "Copy Link" and
    // "Copy team code" flows call `navigator.clipboard.writeText()`, which
    // otherwise rejects with NotAllowedError in a fresh Playwright context.
    permissions: ['clipboard-read', 'clipboard-write'],
  },

  // Global timeout — 45s per test tolerates a warming backend during a long
  // sequential run; 30s occasionally clips heavier tests (media/video, dual
  // context notifications, etc.).
  timeout: 45000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Web server configuration
  // Note: Set SKIP_WEBSERVER=1 if servers are already running locally
  //
  // Runs its own Vite instance on :3002 pointed at the isolated
  // timehuddle-meteor-test backend (:3101 / timehuddle_test db) instead of
  // reusing the pm2-managed dev frontend (:3000 -> :3100 / timehuddle db).
  // Requires timehuddle-meteor-test to already be running (pm2).
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command:
          'API_TARGET=http://localhost:3101 VITE_TIMECORE_URL=http://localhost:3101 npm run dev -- --port 3002 --strictPort',
        url: 'http://localhost:3002',
        timeout: 120000,
        reuseExistingServer: !process.env.CI,
        cwd: '..',
      },
});
