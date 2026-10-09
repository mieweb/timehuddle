import { definePageFlowTests } from './helpers/page-flows';

// The seeded fixture team via PERF_DASH_TEAM_ID; the profiles are the test user's and a teammate's.
const TEAM_ID = process.env.PERF_DASH_TEAM_ID;
const PROFILE = process.env.PERF_PROFILE_USERNAME ?? 'perf_bot';
const TEAMMATE = process.env.PERF_TEAMMATE_USERNAME ?? 'bench_user_3';

definePageFlowTests({
  name: 'work',
  path: `/app/work${TEAM_ID ? `?team=${TEAM_ID}` : ''}`,
  dataCalls: [/\/api\/timers_getDay/, /\/api\/tickets_list/],
  ready: (page) => page.locator('main').getByText('Today'),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'profile',
  path: `/app/profile/${PROFILE}`,
  dataCalls: [],
  ready: (page) => page.locator('main').getByText(`@${PROFILE}`),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'profile-work',
  path: `/app/profile/${PROFILE}?tab=work`,
  dataCalls: [/\/api\/tickets_list/],
  ready: (page) => page.locator('main').getByText(/\d+ active tickets?/),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'profile-teammate',
  path: `/app/profile/${TEAMMATE}`,
  dataCalls: [/\/api\/users_getByUsername/],
  ready: (page) => page.locator('main').getByText(`@${TEAMMATE}`),
  budgetMs: 2500,
});
