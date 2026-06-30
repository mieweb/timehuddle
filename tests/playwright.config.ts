import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: [],
  
  // Run tests in parallel for speed
  fullyParallel: true,
  
  // Retry failed tests once
  retries: 1,
  
  // Limit workers to avoid DB contention
  workers: 2,
  
  // Reporter
  reporter: [['list'], ['html', { outputFolder: '../playwright-report' }]],
  
  // Shared settings for all tests
  use: {
    // Base URL for tests
    baseURL: 'http://localhost:3000',
    
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
  },
  
  // Global timeout
  timeout: 30000,
  
  // Expect timeout
  expect: {
    timeout: 10000,
  },
  
  // Web server configuration
  // Note: Set SKIP_WEBSERVER=1 if servers are already running locally
  webServer: process.env.SKIP_WEBSERVER ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    cwd: '..',
  },
});
