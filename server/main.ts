import '../imports/startup/server';
import '../imports/startup/seed'; // E2E seed data (only when ALLOW_E2E_SEED is set)
import '../imports/startup/ssr'; // SSR: onPageLoad renders landing page & injects SEO
// ─── Features ─────────────────────────────────────────────────────────────────
// Each feature is self-contained: remove an import + its AppLayout route entry
// to fully disable that feature.
import '../imports/features/auth/api';
import '../imports/features/profile/api';
import '../imports/features/inbox/api';
import '../imports/features/teams/api';
import '../imports/features/tickets/api';
import '../imports/features/clock/api';
import '../imports/features/messages/api';
import '../imports/server/push';

console.log('Server startup - TimeHuddle');
