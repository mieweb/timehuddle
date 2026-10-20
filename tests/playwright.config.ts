import { defineConfig, devices } from '@playwright/test';

const e2ePort = process.env.E2E_PORT ?? '3003';
// Which Meteor test instance this run's Vite proxy talks to — overridden per
// shard (see e2e-shard-runner.sh) so each shard's frontend hits its own
// isolated backend/db instead of always 3101.
const apiTarget = process.env.API_TARGET ?? 'http://localhost:3101';
// webServer's command string below sets VITE_TIMECORE_URL for the spawned
// Vite dev server only — tests/e2e/fixtures/users.ts reads the same name
// directly in the worker process for its login-failure health check, which
// never sees that value and falls back to :3101. Setting it here, before
// Playwright forks workers from this process, makes both see the same
// target — the right shard in local dev, and the actual backend (not :3101)
// in CI or on shards 2+.
process.env.VITE_TIMECORE_URL ??= apiTarget;

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

  // Retry failed tests up to twice — the sequential suite runs ~20 minutes
  // against a shared dev machine (mongod + 2 Meteor instances + Vite +
  // Chromium all competing for CPU), which occasionally trips a MongoDB
  // replica-set monitor timeout (`PoolClearedOnNetworkError`) for whichever
  // request happens to be in flight — a transient host-contention blip, not
  // a product bug. A retry after the blip passes reliably.
  retries: 2,

  // Single worker — sequential execution
  workers: 1,

  // Reporter — output folder keyed by shard (see e2e-shard-runner.sh) so two
  // shards running at once don't both write the same html report.
  reporter: [
    ['list'],
    ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_REPORT ?? '../playwright-report' }],
  ],

  // Shared settings for all tests
  use: {
    // Base URL for tests — dedicated e2e frontend (see webServer below),
    // isolated from the pm2-managed dev frontend on :3000 so test runs never
    // touch the dev database.
    baseURL: `http://localhost:${e2ePort}`,

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
  // Runs its own Vite instance on the E2E port pointed at the isolated
  // timehuddle-meteor-test backend (:3101 / timehuddle_test db) instead of
  // reusing the pm2-managed dev frontend (:3000 -> :3100 / timehuddle db).
  // Requires timehuddle-meteor-test to already be running (pm2).
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        // VITE_CACHE_DIR is keyed by port — two shards running at once must not
        // share a Vite cache dir, or one shard's writes corrupt the other's.
        command: `API_TARGET=${apiTarget} VITE_TIMECORE_URL=${apiTarget} VITE_CACHE_DIR=node_modules/.vite-e2e-${e2ePort} npm run dev -- --port ${e2ePort} --strictPort`,
        url: `http://localhost:${e2ePort}`,
        timeout: 120000,
        reuseExistingServer: !process.env.CI,
        cwd: '..',
      },
});
