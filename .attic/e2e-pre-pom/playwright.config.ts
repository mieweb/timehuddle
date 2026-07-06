import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/screenshots.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    launchOptions: {
      slowMo: process.env.PWSLOWMO ? parseInt(process.env.PWSLOWMO, 10) : 0,
    },
    video: process.env.PWVIDEO ? 'on' : 'off',
  },
});
