import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  teamApi,
  type DefaultSettingKey,
  type ResolvedSetting,
  type SettingsEditView,
  type Team,
} from '../../lib/api';
import { ENTERPRISE_DEFAULT_ROWS } from '../enterprise/EnterpriseSettings';
import { TEAM_DEFAULT_ROWS } from '../org/OrganizationSettings';
import { DefaultsCard } from './DefaultsCard';
import { TeamSettingRow } from './TeamSettingRow';
import { TeamSettingsRows } from './TeamSettingsRows';
import { PULSE_SETTING_KEYS, SETTINGS_STRINGS, describeSetting } from './settingsCopy';

const teamContext = vi.hoisted(() => ({ refetchTeams: vi.fn() }));
vi.mock('../../lib/TeamContext', () => ({
  useTeam: () => ({ organizations: [], enterprises: [], refetchTeams: teamContext.refetchTeams }),
}));
vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  teamApi: { updateSettings: vi.fn() },
  orgApi: {},
  enterpriseApi: {},
}));

const names = { org: 'Acme Org', enterprise: 'Acme Enterprise' };
const setting = (overrides: Partial<ResolvedSetting>): ResolvedSetting => ({
  value: true,
  source: 'system',
  locked: false,
  ...overrides,
});

describe('describeSetting', () => {
  it.each([
    [{ source: 'team' as const }, 'team', 'Set on this team'],
    [{ source: 'parentTeam' as const }, 'team', 'Inherited from parent team'],
    [{ source: 'org' as const }, 'team', 'Inherited from Acme Org'],
    [{ source: 'enterprise' as const }, 'team', 'Inherited from Acme Enterprise'],
    [{ source: 'system' as const }, 'team', 'Default'],
    [{ source: 'org' as const, locked: true }, 'team', 'Locked by Acme Org'],
    [{ source: 'enterprise' as const, locked: true }, 'org', 'Locked by Acme Enterprise'],
    [{ source: 'personal' as const, locked: true }, 'team', 'Not applicable to personal teams'],
    [{ source: 'org' as const }, 'org', 'Set on this organization'],
    [
      { source: 'org' as const, locked: true },
      'org',
      'Set on this organization and locked for everything below it',
    ],
    [{ source: 'enterprise' as const }, 'enterprise', 'Set on this enterprise'],
  ] as const)('words %j seen from %s as "%s"', (overrides, level, expected) => {
    expect(describeSetting(setting(overrides), level, names)).toBe(expected);
  });

  it('falls back to a generic name when the viewer cannot see the org or enterprise', () => {
    expect(describeSetting(setting({ source: 'org' }), 'team', {})).toBe(
      'Inherited from the organization',
    );
    expect(describeSetting(setting({ source: 'enterprise', locked: true }), 'team', {})).toBe(
      'Locked by the enterprise',
    );
  });
});

function renderRow(overrides: Partial<ResolvedSetting>, extra: { saving?: boolean } = {}) {
  const onToggle = vi.fn();
  const onReset = vi.fn();
  render(
    <TeamSettingRow
      className="team-setting-test"
      title="Require a plan"
      description="Members post a plan."
      switchLabel="Toggle plan"
      setting={setting(overrides)}
      names={names}
      checked
      saving={extra.saving ?? false}
      onToggle={onToggle}
      onReset={onReset}
    />,
  );
  return { onToggle, onReset };
}

describe('TeamSettingRow', () => {
  afterEach(cleanup);

  it('shows where an inherited value comes from and offers no reset', () => {
    renderRow({ source: 'org' });
    expect(screen.getByText('Inherited from Acme Org')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reset to inherited' })).toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Toggle plan' }).getAttribute('aria-describedby'),
    ).toBe('team-setting-test-status');
  });

  it('offers a reset only for a value set on the team', () => {
    const { onReset } = renderRow({ source: 'team' });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to inherited' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('disables the switch when a higher level locked the value', () => {
    renderRow({ source: 'org', locked: true });
    expect(screen.getByText('Locked by Acme Org')).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: 'Toggle plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Reset to inherited' })).toBeNull();
  });

  it('disables the switch while saving', () => {
    renderRow({ source: 'team' }, { saving: true });
    expect(
      (screen.getByRole('switch', { name: 'Toggle plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('Pulse settings copy', () => {
  it('words the team rows as agreed', () => {
    const team = SETTINGS_STRINGS.teamSettings;
    expect(team.pulseInApp.title).toBe('Record with Pulse in the iPhone app');
    expect(team.pulseClockInOut.title).toBe('Clock in and out with a Pulse video');
    expect(team.pulseSharedDevice.title).toBe('This team uses shared phones');
  });

  it.each(PULSE_SETTING_KEYS)('has team copy for %s', (key) => {
    const copy = SETTINGS_STRINGS.teamSettings[key];
    expect(copy.title).toMatch(/\S/);
    expect(copy.description).toMatch(/\S/);
    expect(copy.switchLabel).toMatch(/\S/);
  });

  it.each([
    ['organization', TEAM_DEFAULT_ROWS, 'Teams without their own choice follow this.'],
    [
      'enterprise',
      ENTERPRISE_DEFAULT_ROWS,
      'Organizations and teams without their own choice follow this.',
    ],
  ] as const)('lists every Pulse default on the %s, lockable', (_, rows, follows) => {
    for (const key of PULSE_SETTING_KEYS) {
      const row = rows.find((r) => r.key === key);
      expect(row?.title).toBe(SETTINGS_STRINGS.pulseDefaults[key].title);
      expect(row?.description.startsWith(`${follows} `)).toBe(true);
      expect(row?.description.length).toBeGreaterThan(follows.length + 1);
      expect(row?.lockable).toBe(true);
    }
  });
});

const off = (): ResolvedSetting => ({ value: false, source: 'system', locked: false });

function makeTeam(resolved: Partial<Team['resolvedSettings']> = {}): Team {
  return {
    id: 'team-1',
    orgId: 'org-1',
    parentTeamId: null,
    name: 'Team',
    description: null,
    members: [],
    admins: [],
    code: 'T1',
    isPersonal: false,
    ticketPrefix: 'TH',
    sourcePrefixes: [],
    settings: { requirePlanForClock: true, autoAcceptJoins: false },
    resolvedSettings: {
      requirePlanForClock: { value: true, source: 'system', locked: false },
      autoAcceptJoins: off(),
      ...resolved,
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
  };
}

// These hand the component the resolvedSettings shape a server sends once its
// publicTeamSettings lists the Pulse keys, and mock teamApi, so they cover the
// rows and the call they make, not the server. The team path also needs the
// server to send the keys (publicTeamSettings, settings/index.js) and accept
// them (teams.updateSettings in teams.js and its schema in main.js); that is
// checked in the browser, not here. The last test pins the rows without them.
describe('TeamSettingsRows, Pulse', () => {
  beforeEach(() => {
    vi.mocked(teamApi.updateSettings)
      .mockReset()
      .mockResolvedValue({} as never);
    teamContext.refetchTeams.mockReset();
  });
  afterEach(cleanup);

  it('shows each Pulse setting off by default, under its own group', () => {
    render(
      <TeamSettingsRows
        team={makeTeam({ pulseInApp: off(), pulseClockInOut: off(), pulseSharedDevice: off() })}
      />,
    );
    expect(screen.getByText(SETTINGS_STRINGS.teamSettings.pulseGroup)).toBeTruthy();
    for (const key of PULSE_SETTING_KEYS) {
      const copy = SETTINGS_STRINGS.teamSettings[key];
      expect(screen.getByText(copy.title)).toBeTruthy();
      expect(
        screen.getByRole('switch', { name: copy.switchLabel }).getAttribute('aria-checked'),
      ).toBe('false');
    }
  });

  it.each(PULSE_SETTING_KEYS)('saves %s on the team when toggled', async (key) => {
    render(
      <TeamSettingsRows
        team={makeTeam({ pulseInApp: off(), pulseClockInOut: off(), pulseSharedDevice: off() })}
      />,
    );
    fireEvent.click(
      screen.getByRole('switch', { name: SETTINGS_STRINGS.teamSettings[key].switchLabel }),
    );
    expect(teamApi.updateSettings).toHaveBeenCalledWith('team-1', { [key]: true });
    await waitFor(() => expect(teamContext.refetchTeams).toHaveBeenCalledOnce());
  });

  it('shows no Pulse rows when the team carries no Pulse settings (publicTeamSettings without them)', () => {
    render(<TeamSettingsRows team={makeTeam()} />);
    expect(screen.queryByText(SETTINGS_STRINGS.teamSettings.pulseGroup)).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});

describe('DefaultsCard, Pulse', () => {
  afterEach(cleanup);

  const view = (): SettingsEditView => ({
    settings: {},
    settingsLocks: {},
    effectiveSettings: Object.fromEntries(
      TEAM_DEFAULT_ROWS.map((row) => [row.key, off()]),
    ) as Record<DefaultSettingKey, ResolvedSetting>,
  });

  it.each(PULSE_SETTING_KEYS)('sets and locks %s on an organization', (key) => {
    const onSave = vi.fn();
    render(
      <DefaultsCard
        level="org"
        title="Team defaults"
        description="Defaults"
        rows={TEAM_DEFAULT_ROWS}
        view={view()}
        names={{}}
        saving={false}
        error={null}
        onSave={onSave}
      />,
    );
    const title = SETTINGS_STRINGS.pulseDefaults[key].title;
    fireEvent.click(screen.getByRole('switch', { name: title }));
    expect(onSave).toHaveBeenLastCalledWith({ settings: { [key]: true } });
    fireEvent.click(
      screen.getByRole('switch', { name: `${SETTINGS_STRINGS.lockForTeams}: ${title}` }),
    );
    expect(onSave).toHaveBeenLastCalledWith({ settings: { [key]: false }, locks: { [key]: true } });
  });
});
