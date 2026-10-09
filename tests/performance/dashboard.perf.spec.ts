import { definePageFlowTests } from './helpers/page-flows';

// Point at the seeded fixture team (members, tickets, clock events) via PERF_DASH_TEAM_ID.
const TEAM_ID = process.env.PERF_DASH_TEAM_ID;

definePageFlowTests({
  name: 'dashboard',
  path: `/app/dashboard${TEAM_ID ? `?teamId=${TEAM_ID}` : ''}`,
  // `tickets_list` is what the dashboard called before the server-side summary.
  dataCalls: [
    /\/api\/clock_teamStatus/,
    /\/api\/tickets_(dashboardSummary|list)/,
    /\/api\/timers_getTeamRunning/,
  ],
  ready: (page) => page.getByText('Hours today'),
  budgetMs: 2500,
});
