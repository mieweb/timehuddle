/**
 * OrganizationSettings — Settings → Organization, for owners and admins of the
 * selected organization: the defaults its teams inherit (with locks) and its
 * ticket ID prefixes. Both cards are unchanged from when they sat on Members.
 */
import { Alert, Spinner } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  orgApi,
  type SettingsEditView,
  type SettingsPatch,
  type SourcePrefix,
} from '../../lib/api';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { DefaultsCard, type DefaultSettingRow } from '../settings/DefaultsCard';
import { TicketIdsCard } from './TicketIdsCard';

const TEAM_DEFAULT_ROWS: DefaultSettingRow[] = [
  {
    key: 'requirePlanForClock',
    title: 'Require a plan for every clock-in/out',
    description: 'Teams without their own choice follow this.',
    lockable: true,
  },
  {
    key: 'autoAcceptJoins',
    title: 'Auto-accept join requests',
    description: 'Anyone joining a team with its code is added without admin approval.',
    lockable: true,
  },
  {
    key: 'allowAutoJoin',
    title: 'Auto-join the organization',
    description: 'People who join a team here are added to the organization too.',
    lockable: false,
  },
];

const STRINGS = {
  title: 'Team defaults',
  description:
    'Defaults for every team in this organization. A team can override a default unless it is locked.',
  failedToLoad: 'Failed to load organization settings',
  failedToSave: 'Failed to update settings',
  loading: 'Loading organization settings',
} as const;

interface Loaded {
  orgId: string;
  view: SettingsEditView;
  canEditTicketIds: boolean;
  ticketPrefix: string;
  sourcePrefixes: SourcePrefix[];
}

export const OrganizationSettings: React.FC = () => {
  const { selectedOrgId, organizations, enterprises, refreshTeamSettings, refetchOrganizations } =
    useTeam();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedOrgId) return;
    setLoadError(null);
    try {
      const organization = await orgApi.getOrganizationById(selectedOrgId);
      setLoaded({
        orgId: selectedOrgId,
        view: organization,
        canEditTicketIds: organization.canEditTicketIds,
        ticketPrefix: organization.ticketPrefix,
        sourcePrefixes: organization.sourcePrefixes,
      });
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : STRINGS.failedToLoad);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRefresh(load);

  const save = useCallback(
    async (patch: { settings?: SettingsPatch; locks?: SettingsPatch }) => {
      if (!selectedOrgId) return;
      setSaving(true);
      setSaveError(null);
      try {
        const view = await orgApi.updateSettings(selectedOrgId, patch);
        setLoaded((prev) => (prev?.orgId === selectedOrgId ? { ...prev, view } : prev));
        refreshTeamSettings();
        refetchOrganizations();
      } catch (err) {
        setSaveError(err instanceof ApiError ? err.message : STRINGS.failedToSave);
      } finally {
        setSaving(false);
      }
    },
    [selectedOrgId, refreshTeamSettings, refetchOrganizations],
  );

  // Names for "Locked by …" / "Inherited from …"; the enterprise's is absent for non-members.
  const enterpriseName = useMemo(() => {
    const enterpriseId = organizations.find((o) => o.id === selectedOrgId)?.enterpriseId;
    return enterprises.find((e) => e.id === enterpriseId)?.name;
  }, [organizations, enterprises, selectedOrgId]);

  if (loadError) return <Alert variant="danger">{loadError}</Alert>;
  if (!selectedOrgId || loaded?.orgId !== selectedOrgId) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" label={STRINGS.loading} />
      </div>
    );
  }

  return (
    <>
      <DefaultsCard
        level="org"
        title={STRINGS.title}
        description={STRINGS.description}
        rows={TEAM_DEFAULT_ROWS}
        view={loaded.view}
        names={{ enterprise: enterpriseName }}
        saving={saving}
        error={saveError}
        onSave={(patch) => void save(patch)}
      />
      {loaded.canEditTicketIds && (
        <TicketIdsCard
          orgId={selectedOrgId}
          ticketPrefix={loaded.ticketPrefix}
          sourcePrefixes={loaded.sourcePrefixes}
        />
      )}
    </>
  );
};
