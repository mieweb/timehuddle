import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentedSwitcher } from './SegmentedSwitcher';

const OPTIONS = [
  { value: 'none', label: 'TimeHuddle only' },
  { value: 'github', label: 'GitHub' },
  { value: 'redmine', label: 'Redmine' },
] as const;

function renderSwitcher(value: (typeof OPTIONS)[number]['value'], onValueChange = vi.fn()) {
  render(
    <SegmentedSwitcher
      name="test"
      label="Tracked in"
      options={OPTIONS}
      value={value}
      onValueChange={onValueChange}
    />,
  );
  return onValueChange;
}

// jsdom has no matchMedia, which @mieweb/ui's Tooltip asks about reduced motion.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }) as MediaQueryList;

afterEach(cleanup);

describe('SegmentedSwitcher', () => {
  it('is a labelled radio group with exactly one option checked', () => {
    renderSwitcher('github');
    expect(screen.getByRole('radiogroup', { name: 'Tracked in' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'GitHub' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Redmine' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('keeps a single tab stop, on the selected option', () => {
    renderSwitcher('github');
    const tabStops = screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0);
    expect(tabStops.map((radio) => radio.textContent)).toEqual(['GitHub']);
  });

  it('selects on click, and not again when it is already selected', () => {
    const onValueChange = renderSwitcher('github');
    fireEvent.click(screen.getByRole('radio', { name: 'Redmine' }));
    fireEvent.click(screen.getByRole('radio', { name: 'GitHub' }));
    expect(onValueChange.mock.calls).toEqual([['redmine']]);
  });

  it('moves the selection with the arrow keys, wrapping at the ends', () => {
    const onValueChange = renderSwitcher('redmine');
    const group = screen.getByRole('radiogroup');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onValueChange.mock.calls).toEqual([['none'], ['github']]);
  });

  it('names an icon-only option by its label, without showing the text', () => {
    render(
      <SegmentedSwitcher
        name="views"
        label="View"
        hideLabel
        options={[
          { value: 'board', label: 'My Board' },
          { value: 'all', label: 'All Sources', icon: <svg data-testid="icon" />, iconOnly: true },
        ]}
        value="board"
        onValueChange={vi.fn()}
      />,
    );
    const iconOnly = screen.getByRole('radio', { name: 'All Sources' });
    expect(iconOnly.textContent).toBe('');
    // No tooltip either: the icon is the whole of what is shown.
    fireEvent.focus(iconOnly);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(screen.getByTestId('icon')).toBeTruthy();
    // The group keeps its name with the visible label hidden.
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeTruthy();
  });
});
