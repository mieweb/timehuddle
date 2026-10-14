import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Switch, Text } from '@mieweb/ui';
import React from 'react';

import type { DefaultSettingKey, SettingsEditView, SettingsPatch } from '../../lib/api';
import {
  SETTINGS_STRINGS,
  describeSetting,
  type SettingsLevel,
  type SourceNames,
} from './settingsCopy';

export interface DefaultSettingRow {
  key: DefaultSettingKey;
  title: string;
  description: string;
  /** Whether this level can lock the setting for everything below it. */
  lockable: boolean;
}

interface DefaultsCardProps {
  level: Exclude<SettingsLevel, 'team'>;
  title: string;
  description: string;
  rows: DefaultSettingRow[];
  view: SettingsEditView;
  names: SourceNames;
  saving: boolean;
  error: string | null;
  onSave: (patch: { settings?: SettingsPatch; locks?: SettingsPatch }) => void;
  className?: string;
}

/** Defaults an org or enterprise sets for what is below it, each with an optional lock. */
export const DefaultsCard: React.FC<DefaultsCardProps> = ({
  level,
  title,
  description,
  rows,
  view,
  names,
  saving,
  error,
  onSave,
  className,
}) => (
  <Card padding="lg" className={`settings-defaults space-y-4 ${className ?? ''}`}>
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      <Text variant="muted" size="sm">
        {description}
      </Text>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <Alert variant="danger">{error}</Alert>}
      {rows.map((row) => {
        const effective = view.effectiveSettings[row.key];
        const ownValue = view.settings[row.key];
        // An enterprise's lock stops its orgs from changing the value.
        const lockedAbove =
          effective.locked && effective.source === 'enterprise' && level === 'org';
        const statusId = `settings-default-${row.key}-status`;
        const lockLabel =
          level === 'org' ? SETTINGS_STRINGS.lockForTeams : SETTINGS_STRINGS.lockForOrgsAndTeams;
        return (
          <div
            key={row.key}
            className={`settings-default-row settings-default-${row.key} flex flex-wrap items-start justify-between gap-4`}
          >
            <div>
              <Text size="sm" weight="medium">
                {row.title}
              </Text>
              <Text variant="muted" size="xs">
                {row.description}
              </Text>
              <div className="settings-default-source flex items-center gap-2">
                <Text id={statusId} variant="muted" size="xs">
                  {describeSetting(effective, level, names)}
                </Text>
                {ownValue !== undefined && !lockedAbove && (
                  <Button
                    variant="link"
                    size="sm"
                    disabled={saving}
                    onClick={() =>
                      onSave({ settings: { [row.key]: null }, locks: { [row.key]: null } })
                    }
                  >
                    {SETTINGS_STRINGS.resetToInherited}
                  </Button>
                )}
              </div>
            </div>
            <div className="settings-default-controls flex items-center gap-4">
              <Switch
                checked={effective.value}
                disabled={saving || lockedAbove}
                aria-label={row.title}
                aria-describedby={statusId}
                onCheckedChange={(checked) => onSave({ settings: { [row.key]: checked } })}
              />
              {row.lockable && (
                <Switch
                  checked={view.settingsLocks[row.key] === true}
                  disabled={saving || lockedAbove}
                  label={lockLabel}
                  aria-label={`${lockLabel}: ${row.title}`}
                  onCheckedChange={(locked) =>
                    onSave(
                      locked
                        ? { settings: { [row.key]: effective.value }, locks: { [row.key]: true } }
                        : { locks: { [row.key]: null } },
                    )
                  }
                />
              )}
            </div>
          </div>
        );
      })}
    </CardContent>
  </Card>
);
