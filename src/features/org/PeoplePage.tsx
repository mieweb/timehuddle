/**
 * PeoplePage — `/app/organization`, "People" in the nav.
 *
 * Everyone sees the org chart. Owners and admins of the selected organization
 * also get the Members roster and Pending invitations as tabs (`?tab=`, push),
 * with Organization settings, Add existing user and Invite by email in the
 * header. The server checks every admin action; this only decides what shows.
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@mieweb/ui';
import React, { useReducer } from 'react';

import { canManageSelectedOrganization } from '../../lib/organizationAccess';
import { useTeam } from '../../lib/TeamContext';
import { AppPage } from '../../ui/AppPage';
import { useQueryParam } from '../../ui/router';
import { InvitationsPanel } from './InvitationsPanel';
import { MembersPanel } from './MembersPanel';
import { OrgChartPanel } from './OrgChartPanel';
import { PeopleActions } from './PeopleActions';
import { PEOPLE_STRINGS } from './peopleStrings';

const ADMIN_TABS = ['members', 'invitations', 'chart'] as const;
type AdminTab = (typeof ADMIN_TABS)[number];

export const PeoplePage: React.FC = () => {
  const { organizations, enterprises, selectedOrgId } = useTeam();
  const isAdmin = canManageSelectedOrganization(organizations, enterprises, selectedOrgId);
  const [tabParam, setTabParam] = useQueryParam('tab', { mode: 'push' });
  // Adding or inviting someone in the header reloads the panels.
  const [reloadKey, reload] = useReducer((n: number) => n + 1, 0);

  if (!isAdmin) {
    return (
      <AppPage fill flush>
        <OrgChartPanel />
      </AppPage>
    );
  }

  // Admins land on the roster; a stale or hand-edited `?tab=` falls back to it.
  const tab: AdminTab = ADMIN_TABS.includes(tabParam as AdminTab)
    ? (tabParam as AdminTab)
    : 'members';
  const T = PEOPLE_STRINGS.tabs;

  return (
    <AppPage
      width="wide"
      fill
      titleActions={
        // Keyed by org: a Back/Forward org switch closes any open Add/Invite
        // dialog, so it can't submit to the newly selected organization.
        <PeopleActions key={selectedOrgId} onChanged={reload} />
      }
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTabParam(value === 'members' ? null : value)}
        className="people-tabs flex min-h-0 flex-1 flex-col"
      >
        <TabsList aria-label={T.label} className="shrink-0">
          <TabsTrigger value="members">{T.members}</TabsTrigger>
          <TabsTrigger value="invitations">{T.invitations}</TabsTrigger>
          <TabsTrigger value="chart">{T.chart}</TabsTrigger>
        </TabsList>
        {/* Keyed by organization: switching orgs drops the old rows, dialogs and
            in-flight responses, so nothing can act on one org from another's list.
            The chart has no realtime feed, so an add or invite remounts it too. */}
        <TabsContent value="members" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <MembersPanel key={selectedOrgId} reloadKey={reloadKey} />
        </TabsContent>
        <TabsContent value="invitations" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <InvitationsPanel key={selectedOrgId} reloadKey={reloadKey} />
        </TabsContent>
        <TabsContent value="chart" className="min-h-0 flex-1 pt-4">
          <OrgChartPanel key={`${selectedOrgId}-${reloadKey}`} />
        </TabsContent>
      </Tabs>
    </AppPage>
  );
};
