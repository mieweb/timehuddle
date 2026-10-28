/**
 * EnterpriseSettings — Settings → Enterprise, for owners and admins of the
 * selected enterprise: its name, and the defaults its organizations and teams
 * inherit (with locks). Moved here from the Enterprise page.
 */
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
} from '@mieweb/ui';
import React, { useEffect, useState } from 'react';

import { ApiError, enterpriseApi, type SettingsPatch } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { DefaultsCard, type DefaultSettingRow } from '../settings/DefaultsCard';
import { ENTERPRISE_STRINGS } from './enterpriseStrings';
import { useEnterpriseDetail } from './useEnterpriseDetail';

export const ENTERPRISE_DEFAULT_ROWS: DefaultSettingRow[] = [
  {
    key: 'requirePlanForClock',
    title: 'Require a plan for every clock-in/out',
    description: 'Organizations and teams without their own choice follow this.',
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
    description: 'People who join a team are added to its organization too.',
    lockable: true,
  },
];

const S = ENTERPRISE_STRINGS.settings;

export const EnterpriseSettings: React.FC = () => {
  const { refetchEnterprises, refetchOrganizations, refreshTeamSettings } = useTeam();
  const { enterprise, error, patch } = useEnterpriseDetail();
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  useEffect(() => {
    if (enterprise) setName(enterprise.name);
  }, [enterprise?.id, enterprise?.name]); // Reseed only when a different enterprise or a saved rename arrives.

  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!enterprise) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" label={ENTERPRISE_STRINGS.page.loading} />
      </div>
    );
  }

  const saveName = async () => {
    const next = name.trim();
    if (!next) return setNameError(S.nameRequired);
    setSavingName(true);
    setNameError(null);
    try {
      const updated = await enterpriseApi.updateName(enterprise.id, next);
      patch({ ...updated, id: enterprise.id });
      refetchEnterprises();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : S.nameFailed);
    } finally {
      setSavingName(false);
    }
  };

  const saveDefaults = async (change: { settings?: SettingsPatch; locks?: SettingsPatch }) => {
    setSavingDefaults(true);
    setDefaultsError(null);
    try {
      const view = await enterpriseApi.updateSettings(enterprise.id, change);
      patch({ ...view, id: enterprise.id });
      refreshTeamSettings();
      refetchOrganizations();
    } catch (err) {
      setDefaultsError(err instanceof ApiError ? err.message : S.defaultsFailed);
    } finally {
      setSavingDefaults(false);
    }
  };

  return (
    <>
      <Card padding="lg" className="enterprise-general">
        <CardHeader>
          <CardTitle>{S.generalTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 max-w-md flex-1">
            <Input
              label={S.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              helperText={S.nameHelp}
              error={nameError ?? undefined}
              disabled={savingName}
            />
          </div>
          <Button
            className="mt-6"
            onClick={() => void saveName()}
            disabled={savingName || !name.trim() || name.trim() === enterprise.name}
            isLoading={savingName}
          >
            {S.save}
          </Button>
        </CardContent>
      </Card>
      <DefaultsCard
        level="enterprise"
        title={S.defaultsTitle}
        description={S.defaultsDescription}
        rows={ENTERPRISE_DEFAULT_ROWS}
        view={enterprise}
        names={{}}
        saving={savingDefaults}
        error={defaultsError}
        onSave={(change) => void saveDefaults(change)}
      />
    </>
  );
};
