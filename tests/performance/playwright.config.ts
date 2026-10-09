import { defineConfig, devices } from '@playwright/test';

// Runs against a deployed environment — no webServer, no DB seeding.
// Point PERF_BASE_URL at production to compare with dev (same code on both).
const baseURL = process.env.PERF_BASE_URL ?? 'https://timehuddledev.os.mieweb.org';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.perf.spec.ts',
  // Serial single worker: parallel runs would contend for CPU/network and skew timings.
  fullyParallel: false,
  workers: 1,
  // A retry would hide the variance we are trying to measure.
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
  },
});
