import { Button, Select, Text } from '@mieweb/ui';
import YAML from 'yaml';
import React, { useRef, useMemo, useState } from 'react';

import { AppPage } from '../../ui/AppPage';
import { YamlEditor } from './YamlEditor';
import { runSeedImport } from './seedImport';
import { useTeam } from '../../lib/TeamContext';

import techTeamsPreset from './presets/tech-teams.yaml?raw';
import businessOrgPreset from './presets/business-org.yaml?raw';
import fullEnterprisePreset from './presets/full-enterprise.yaml?raw';
import userPreset from './presets/single-user.yaml?raw';

function hasTopLevelTeams(yamlStr: string): boolean {
  try {
    const doc = YAML.parse(yamlStr);
    return (
      !!doc &&
      Array.isArray(doc.teams) &&
      doc.teams.length > 0 &&
      !doc.organizations &&
      !doc.enterprise
    );
  } catch {
    return false;
  }
}

type Preset = {
  id: string;
  label: string;
  description: string;
  yaml: string;
};

const PRESETS: Preset[] = [
  {
    id: 'tech-teams',
    label: 'Technical Teams',
    description: 'Add Developers, Builders, and CAD teams to active org.',
    yaml: techTeamsPreset,
  },
  {
    id: 'business-org',
    label: 'Generic Business',
    description: 'Marketing, Accounting, and Payroll under one organization.',
    yaml: businessOrgPreset,
  },
  {
    id: 'full-enterprise',
    label: 'Multiple Orgs',
    description: 'Create a handful of Org types with various teams each.',
    yaml: fullEnterprisePreset,
  },
  {
    id: 'single-user',
    label: 'User Import',
    description: 'Create users not associated with an organization.',
    yaml: userPreset,
  },
];

export const SeederPage: React.FC = () => {
  const { selectedOrgId, organizations } = useTeam();
  const selectedOrg = organizations.find((o) => o.id === selectedOrgId) ?? null;
  const [yaml, setYaml] = useState(techTeamsPreset);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsOrg = useMemo(() => hasTopLevelTeams(yaml), [yaml]);

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

  const handleOpenFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setYaml(reader.result);
        setParseError(null);
        setSubmitError(null);
        setResult(null);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRun = async () => {
    setParseError(null);
    setSubmitError(null);
    setResult(null);
    setLoading(true);
    try {
      const outcome = await runSeedImport(yaml, selectedOrgId || undefined);
      setResult(outcome.summary);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Seed import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppPage width="wide">
      <div className="space-y-6">
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            {/* Mobile: dropdown */}
            <div className="lg:hidden">
              <Select
                label="Preset"
                hideLabel
                size="sm"
                value={PRESETS[0].id}
                onValueChange={(val) => {
                  const preset = PRESETS.find((p) => p.id === val);
                  if (preset) applyPreset(preset);
                }}
                options={PRESETS.map((p) => ({ value: p.id, label: p.label }))}
                aria-label="Select a preset"
              />
            </div>

            {/* Desktop: full preset buttons */}
            <div className="hidden lg:block">
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

              {organizations.length === 0 && needsOrg && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  No organizations exist yet. Run the <strong>Org + Team</strong> preset first to
                  create one, then come back to <strong>Team</strong>.
                </div>
              )}

              <div className="mt-3 rounded-lg border border-dashed border-neutral-300 p-3 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                Paste or edit some YAML then click Import to seed data.
              </div>
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

            {needsOrg && (
              <div
                className={`rounded-xl border px-3 py-2 text-sm ${
                  selectedOrg
                    ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                }`}
              >
                {selectedOrg ? (
                  <>
                    Teams will be added to: <strong>{selectedOrg.name}</strong>
                  </>
                ) : (
                  'No organization selected — select an org in the sidebar before importing.'
                )}
              </div>
            )}

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

            <div className="flex justify-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".yml,.yaml"
                className="hidden"
                onChange={handleOpenFile}
              />
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                Open
              </Button>
              <Button
                variant="primary"
                onClick={handleRun}
                isLoading={loading}
                disabled={!!yamlSyntaxError || (needsOrg && !selectedOrgId)}
              >
                Import
              </Button>
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
};
