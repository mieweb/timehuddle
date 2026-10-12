import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedSetting } from '../../lib/api';
import { TeamSettingRow } from './TeamSettingRow';
import { describeSetting } from './settingsCopy';

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
