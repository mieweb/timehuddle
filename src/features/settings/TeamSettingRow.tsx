import { Button, Switch, Text } from '@mieweb/ui';
import React from 'react';

import type { ResolvedSetting } from '../../lib/api';
import { SETTINGS_STRINGS, describeSetting, type SourceNames } from './settingsCopy';

interface TeamSettingRowProps {
  /** Semantic class for the row; e2e specs find the setting by it. */
  className: string;
  title: string;
  description: string;
  /** Accessible name of the switch. */
  switchLabel: string;
  setting: ResolvedSetting;
  names: SourceNames;
  /** The switch position: the saved value, or the optimistic one while saving. */
  checked: boolean;
  saving: boolean;
  onToggle: (checked: boolean) => void;
  onReset: () => void;
}

/** One team setting: its switch, where the value comes from, and a way back to inherited. */
export const TeamSettingRow: React.FC<TeamSettingRowProps> = ({
  className,
  title,
  description,
  switchLabel,
  setting,
  names,
  checked,
  saving,
  onToggle,
  onReset,
}) => {
  const statusId = `${className}-status`;
  const canReset = setting.source === 'team' && !setting.locked;

  return (
    <div className={`${className} mb-6 flex items-center justify-between gap-4`}>
      <div>
        <Text size="sm" weight="medium">
          {title}
        </Text>
        <Text variant="muted" size="xs">
          {description}
        </Text>
        <div className="team-setting-source flex items-center gap-2">
          <Text id={statusId} variant="muted" size="xs">
            {describeSetting(setting, 'team', names)}
          </Text>
          {canReset && (
            <Button variant="link" size="sm" disabled={saving} onClick={onReset}>
              {SETTINGS_STRINGS.resetToInherited}
            </Button>
          )}
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={saving || setting.locked}
        aria-label={switchLabel}
        aria-describedby={statusId}
        onCheckedChange={onToggle}
      />
    </div>
  );
};
