import { definePageFlowTests } from './helpers/page-flows';

// Point at the seeded fixture team (many members, hundreds of tickets) via PERF_DASH_TEAM_ID.
const TEAM_ID = process.env.PERF_DASH_TEAM_ID;
const scope = TEAM_ID ? `?teamId=${TEAM_ID}` : '';

definePageFlowTests({
  name: 'teams',
  path: `/app/teams${scope}`,
  dataCalls: [/\/api\/teams_getMembers/],
  // A member row exists only after the members call has rendered.
  ready: (page) => page.getByText(/Bench User \d+/),
  budgetMs: 2500,
});

definePageFlowTests({
  name: 'tickets',
  path: `/app/tickets${scope}`,
  // My Board opens first; the other view stays mounted but hidden, so scope to the shown panel.
  dataCalls: [/\/api\/myBoard_list/],
  ready: (page) => page.locator('.tickets-view-panel.flex').getByText(/Bench ticket \d+/),
  budgetMs: 2500,
});
