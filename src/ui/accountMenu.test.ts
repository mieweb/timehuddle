/**
 * Access rules for the account menu's Admin / Developers / Help groups.
 *
 * Both the avatar dropdown and the mobile More sheet render these sections,
 * so these tests pin the rules both surfaces show — in particular that an
 * organization admin outside any enterprise gets Admin with Usage.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./AppLayout', () => ({ useAppFeedback: vi.fn() }));
vi.mock('./router', () => ({ useRouter: vi.fn() }));
vi.mock('../lib/TeamContext', () => ({ useTeam: vi.fn() }));
vi.mock('../lib/useSession', () => ({ useSession: vi.fn() }));

import { buildAccountMenuSections, type AccountMenuAccess } from './accountMenu';

const actions = {
  navigate: vi.fn(),
  openReportIssue: vi.fn(),
  openFeedback: vi.fn(),
  openAppStore: vi.fn(),
};

const MEMBER: AccountMenuAccess = {
  user: null,
  enterpriseCount: 0,
  organizations: [{ role: 'member' }],
  isProduction: true,
};

function layout(access: Partial<AccountMenuAccess>) {
  return buildAccountMenuSections({ ...MEMBER, ...access }, actions).map((section) => [
    section.id,
    section.items.map((item) => item.label),
  ]);
}

describe('buildAccountMenuSections', () => {
  it('shows a plain member only Help in production', () => {
    expect(layout({})).toEqual([['help', ['Report an Issue', 'Share Your Feedback', 'App Store']]]);
  });

  it('shows an organization admin Admin with Members and Usage', () => {
    expect(layout({ organizations: [{ role: 'member' }, { role: 'admin' }] })[0]).toEqual([
      'admin',
      ['Members', 'Usage'],
    ]);
  });

  it('shows an enterprise member Admin with Enterprise and Members, without Usage', () => {
    expect(layout({ enterpriseCount: 1 })[0]).toEqual(['admin', ['Enterprise', 'Members']]);
  });

  it('adds Developers only outside production', () => {
    expect(layout({ isProduction: false }).map(([id]) => id)).toEqual(['developers', 'help']);
  });

  it('routes Usage to the org usage page', () => {
    const [admin] = buildAccountMenuSections(
      { ...MEMBER, organizations: [{ role: 'owner' }] },
      actions,
    );
    admin.items.find((item) => item.label === 'Usage')?.onSelect();
    expect(actions.navigate).toHaveBeenCalledWith('/app/org/usage');
  });
});
