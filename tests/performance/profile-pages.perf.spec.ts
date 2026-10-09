import { definePageFlowTests } from './helpers/page-flows';

// Settings, Enterprise, Members, Usage and What's New: one spec per page.
// Members, Usage and Enterprise need the test user to be an org/enterprise owner.

definePageFlowTests({
  name: 'settings',
  path: '/app/settings',
  dataCalls: [/\/api\/users_get/],
  ready: (page) => page.locator('main').getByText('perf-bot@test.local'),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'enterprise',
  path: '/app/enterprise',
  dataCalls: [/\/api\/enterprises_get/],
  ready: (page) => page.locator('main').getByText('Default Enterprise'),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'members',
  path: '/app/org/members',
  dataCalls: [/\/api\/orgs_listMembers/],
  ready: (page) => page.locator('main').getByText(/Bench User \d+/),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'usage',
  path: '/app/org/usage',
  dataCalls: [/\/api\/usage_orgUsage/],
  ready: (page) => page.locator('main').getByText(/did something in this period/),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'whats-new',
  path: '/app/release-notes',
  dataCalls: [],
  ready: (page) => page.locator('main').getByText(/^Version \d/),
  budgetMs: 2500,
});
