import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable team state backing the mocked useTeam() hook. Tests tweak
// `selectedOrgId` to exercise the "org selected" vs "no org" gating.
const { teamState } = vi.hoisted(() => ({
  teamState: {
    selectedOrgId: 'org-1' as string | null,
    organizations: [{ id: 'org-1', name: 'Demo Org' }],
  },
}));

vi.mock('../../lib/TeamContext', () => ({
  useTeam: () => teamState,
}));

// Replace CodeMirror editor with a plain textarea so jsdom can interact with it.
vi.mock('./YamlEditor', () => ({
  YamlEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock('./seedImport', () => ({
  runSeedImport: vi.fn().mockResolvedValue({
    summary: 'Created: 2 users, 1 orgs, 1 teams, 1 tickets',
    created: { enterprises: 0, organizations: 1, teams: 1, users: 2, tickets: 1 },
    updated: { enterprises: 0, organizations: 0, teams: 0, users: 0 },
  }),
}));

vi.mock('@mieweb/ui', () => ({
  Button: ({
    children,
    isLoading: _isLoading,
    loadingText: _loadingText,
    ...rest
  }: {
    children: ReactNode;
    isLoading?: boolean;
    loadingText?: string;
    [key: string]: unknown;
  }) => <button {...rest}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Select: ({
    options,
    onValueChange,
    value,
    ...rest
  }: {
    options: { value: string; label: string }[];
    onValueChange?: (val: string) => void;
    value?: string;
    [key: string]: unknown;
  }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { runSeedImport } from './seedImport';
import { SeederPage } from './SeederPage';

beforeEach(() => {
  // Default to an org being selected so Import is enabled.
  teamState.selectedOrgId = 'org-1';
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SeederPage', () => {
  it('loads a preset into the editor and imports it', async () => {
    render(<SeederPage />);

    // Switch to Generic Business preset — its YAML contains "Midwest Services"
    fireEvent.click(screen.getByRole('button', { name: /Generic Business/i }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain(
      'Midwest Services',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect((await screen.findByRole('status')).textContent).toContain('Created: 2 users');
    expect(runSeedImport).toHaveBeenCalledWith(
      expect.stringContaining('Midwest Services'),
      'org-1',
    );
  }, 15_000);

  it('disables Import and shows inline error on invalid YAML', async () => {
    render(<SeederPage />);

    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, {
      target: { value: 'users:\n  - email: broken@example.com\n    name: [' },
    });

    expect(screen.getByRole('alert').textContent).toContain('YAML syntax error');
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(runSeedImport).not.toHaveBeenCalled();
  });

  it('shows an import error when runSeedImport rejects', async () => {
    vi.mocked(runSeedImport).mockRejectedValueOnce(new Error('Unknown user: ghost@example.com'));
    render(<SeederPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect((await screen.findByRole('alert')).textContent).toContain('ghost@example.com');
  });

  it('disables Import for a top-level-teams preset when no org is selected', () => {
    teamState.selectedOrgId = null;
    render(<SeederPage />);

    // Default preset (Team) has top-level teams, so an org is required.
    expect(screen.getByText(/No organization selected/i)).toBeTruthy();
    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    expect(runSeedImport).not.toHaveBeenCalled();
  });
});
