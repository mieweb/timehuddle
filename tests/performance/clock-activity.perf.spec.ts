import { definePageFlowTests } from './helpers/page-flows';

// The seeded fixture team (members, tickets, activity, past shifts) via PERF_DASH_TEAM_ID.
const TEAM_ID = process.env.PERF_DASH_TEAM_ID;
const scope = TEAM_ID ? `?team=${TEAM_ID}` : '';

definePageFlowTests({
  name: 'clock',
  path: `/app/clock${scope}`,
  dataCalls: [/\/api\/clock_events/],
  ready: (page) => page.locator('.clock-recent-sessions .divide-y > div'),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'activity',
  path: `/app/activity${scope}`,
  dataCalls: [/\/api\/activity_log/],
  ready: (page) => page.locator('main').getByText(/Bench User \d+/),
  budgetMs: 2500,
});
