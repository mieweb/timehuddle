/**
 * "Bring your recent tickets from [sources] [Fetch]": an empty My Board's first
 * fill, from whichever connected sources the member picks in the dropdown.
 */
import { Button, Select, Text } from '@mieweb/ui';
import React from 'react';

import { UserRoundArrowLeft } from '../../ui/UserRoundArrowLeft';

import type { AssignedSource } from './assignedSources';
import { starterText } from './assignedStarter';

interface AssignedSourcePickerProps {
  sources: AssignedSource[];
  picked: string[];
  busy: boolean;
  onPickedChange: (ids: string[]) => void;
  onFetch: () => void;
}

/** The "All sources" option's value: no source has it as its id. */
const ALL = '*';

/**
 * What a change of the dropdown's values picks: "All sources" picked picks
 * every source, and unpicked clears them; any other change is taken as it is.
 */
export function pickedAfter(values: string[], ids: string[], picked: string[]): string[] {
  const hadAll = ids.length > 0 && ids.every((id) => picked.includes(id));
  const hasAll = values.includes(ALL);
  if (hasAll && !hadAll) return ids;
  if (!hasAll && hadAll) return [];
  return values.filter((value) => value !== ALL);
}

export const AssignedSourcePicker: React.FC<AssignedSourcePickerProps> = ({
  sources,
  picked,
  busy,
  onPickedChange,
  onFetch,
}) => {
  const ids = sources.map((source) => source.id);
  const offerAll = sources.length > 1;
  const allPicked = offerAll && ids.every((id) => picked.includes(id));
  return (
    <div className="assigned-source-picker flex max-w-full flex-wrap items-center justify-center gap-2">
      <Text size="sm" variant="muted" aria-hidden="true">
        {starterText.bringFrom}
      </Text>
      <Select
        multiple
        size="sm"
        className="assigned-source-select w-64 max-w-full"
        aria-label={starterText.sourcesLabel}
        placeholder={starterText.pickPlaceholder}
        options={[
          ...(offerAll ? [{ value: ALL, label: starterText.allSources }] : []),
          ...sources.map((source) => ({ value: source.id, label: source.label })),
        ]}
        value={allPicked ? [ALL, ...picked] : picked}
        onValueChange={(values) => onPickedChange(pickedAfter(values, ids, picked))}
        disabled={busy}
      />
      <Button
        variant="primary"
        size="sm"
        leftIcon={<UserRoundArrowLeft className="h-4 w-4" aria-hidden="true" />}
        isLoading={busy}
        loadingText={starterText.getting}
        disabled={picked.length === 0}
        onClick={onFetch}
        aria-label={starterText.fetchLabel}
      >
        {starterText.fetch}
      </Button>
    </div>
  );
};
