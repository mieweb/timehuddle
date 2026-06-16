import { Button, Text } from '@mieweb/ui';
import YAML from 'yaml';
import React, { useMemo, useState } from 'react';

import { AppPage } from '../../ui/AppPage';
import { YamlEditor } from './YamlEditor';
import { runSeedImport } from './seedImport';
import { useTeam } from '../../lib/TeamContext';

import teamPreset from './presets/team-only.yaml?raw';
import orgPreset from './presets/org-with-team.yaml?raw';
import userPreset from './presets/single-user.yaml?raw';

type Preset = {
  id: string;
  label: string;
  description: string;
  yaml: string;
};

const PRESETS: Preset[] = [
  {
    id: 'team-only',
    label: 'Team',
    description: 'A team with 5 members in different roles and tickets.',
    yaml: teamPreset,
  },
  {
    id: 'org-team',
    label: 'Org + Team',
    description: 'A single organization with one team and tickets.',
    yaml: orgPreset,
  },
  {
    id: 'single-user',
    label: 'Single User',
    description: 'Just a few users for quick login and role tests.',
    yaml: userPreset,
  },
];

export const SeederPage: React.FC = () => {
  const { selectedOrgId } = useTeam();
  const [yaml, setYaml] = useState(teamPreset);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const yamlSyntaxError = useMemo(() => {
    try {
      YAML.parse(yaml);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid YAML';
    }
  }, [yaml]);

  const applyPreset = (preset: Preset) => {
    setYaml(preset.yaml);
    setParseError(null);
    setSubmitError(null);
    setResult(null);
  };

  const handleRun = async () => {
    setParseError(null);
    setSubmitError(null);
    setResult(null);
    setLoading(true);
    try {
      const outcome = await runSeedImport(yaml, selectedOrgId || undefined);
      setResult(outcome.summary);
      // Reload page so other components pick up the new data
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Seed import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppPage fullWidth className="max-w-7xl">
      <div className="space-y-6">
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <div className="mb-3">
              <Text variant="muted" size="sm" weight="medium">
                Presets
              </Text>
            </div>
            <div className="space-y-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-3 text-left transition hover:border-primary-400 hover:bg-primary-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-primary-500 dark:hover:bg-primary-950/40"
                >
                  <div className="font-medium text-neutral-900 dark:text-neutral-50">
                    {preset.label}
                  </div>
                  <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-3 rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              Paste or edit YAML below. The parser validates syntax before the import runs.
            </div>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Text variant="muted" size="sm">
                YAML
              </Text>
            </div>

            <YamlEditor
              value={yaml}
              onChange={(v) => {
                setYaml(v);
                setParseError(null);
                setSubmitError(null);
                setResult(null);
              }}
            />

            {(yamlSyntaxError || parseError) && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                YAML syntax error: {parseError ?? yamlSyntaxError}
              </div>
            )}

            {submitError && (
              <div
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                Import error: {submitError}
              </div>
            )}

            {result && (
              <div
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                role="status"
              >
                {result}
              </div>
            )}

            <Button
              variant="primary"
              onClick={handleRun}
              isLoading={loading}
              disabled={!!yamlSyntaxError}
            >
              Import
            </Button>
          </div>
        </div>
      </div>
    </AppPage>
  );
};
