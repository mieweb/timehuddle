/**
 * Component tests for the forced-update gate.
 *
 * These stand in for most of the manual check-list: that the overlay appears
 * only when the backend says the bundle is too old, that it cannot be
 * dismissed, that a failed download offers a retry, and that a `set()` which
 * fails to reload the WebView does not strand the user on a dead progress bar.
 *
 * What they deliberately do not cover is the native half — a real download,
 * the WebView reload, and the plugin's own background updater. That needs a
 * device; see the OTA section of the PR for the manual steps.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const otaMocks = vi.hoisted(() => ({
  checkForcedUpdate: vi.fn(),
  applyForcedUpdate: vi.fn(),
}));

vi.mock('../lib/ota', () => ({
  checkForcedUpdate: otaMocks.checkForcedUpdate,
  applyForcedUpdate: otaMocks.applyForcedUpdate,
}));

import { OtaUpdateGate } from './OtaUpdateGate';

const UPDATE = {
  minVersion: '1.0.2',
  version: '1.0.2',
  url: 'http://localhost:3100/ota/bundles/testflight/1.0.2.zip',
  checksum: 'abc123',
  running: '1.0',
};

const CHILD = <p>app content</p>;

function renderGate() {
  return render(<OtaUpdateGate>{CHILD}</OtaUpdateGate>);
}

/** The overlay never resolves in real use — set() reloads the WebView. */
function neverResolves() {
  return new Promise<void>(() => {});
}

beforeEach(() => {
  otaMocks.checkForcedUpdate.mockResolvedValue(null);
  otaMocks.applyForcedUpdate.mockImplementation(neverResolves);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('when the running bundle is current', () => {
  // Web, dev, off-channel and an unreachable backend all collapse to null in
  // checkForcedUpdate — this is the single "do not block the user" case.
  it('renders children and never shows the overlay', async () => {
    renderGate();

    expect(await screen.findByText('app content')).toBeTruthy();
    await waitFor(() => expect(otaMocks.checkForcedUpdate).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.querySelector('.ota-update-gate')).toBeNull();
    expect(otaMocks.applyForcedUpdate).not.toHaveBeenCalled();
  });

  it('does not block when the check itself rejects', async () => {
    otaMocks.checkForcedUpdate.mockRejectedValue(new Error('offline'));
    renderGate();

    expect(await screen.findByText('app content')).toBeTruthy();
    await waitFor(() => expect(otaMocks.checkForcedUpdate).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('when the running bundle is below minVersion', () => {
  beforeEach(() => {
    otaMocks.checkForcedUpdate.mockResolvedValue(UPDATE);
  });

  it('shows the blocking overlay and starts the download', async () => {
    renderGate();

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Updating TimeHuddle')).toBeTruthy();
    await waitFor(() => expect(otaMocks.applyForcedUpdate).toHaveBeenCalledTimes(1));
    expect(otaMocks.applyForcedUpdate.mock.calls[0][0]).toEqual(UPDATE);
  });

  it('shows the version transition', async () => {
    renderGate();
    expect(await screen.findByText('v1.0 → v1.0.2')).toBeTruthy();
  });

  it('offers no way to dismiss the gate', async () => {
    renderGate();
    await screen.findByRole('alertdialog');

    // The only control that may ever appear is the retry, and only on failure.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /close|cancel|dismiss|skip|later/i })).toBeNull();
  });

  it('is announced to assistive technology', async () => {
    renderGate();
    const dialog = await screen.findByRole('alertdialog');

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-live')).toBe('assertive');
    // Labelled and described by elements that actually exist.
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')).toBeTruthy();

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-label')).toBeTruthy();
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('reflects download progress reported by the plugin', async () => {
    otaMocks.applyForcedUpdate.mockImplementation(
      (_u: unknown, onProgress?: (p: number) => void) => {
        onProgress?.(64);
        return neverResolves();
      },
    );
    renderGate();

    await waitFor(() =>
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('64'),
    );
  });

  it('sits above the app rather than replacing it', async () => {
    renderGate();
    await screen.findByRole('alertdialog');
    // Children stay mounted — the overlay is painted on top, so the app is not
    // torn down and remounted when the gate appears.
    expect(screen.getByText('app content')).toBeTruthy();
  });
});

describe('when the download fails', () => {
  beforeEach(() => {
    otaMocks.checkForcedUpdate.mockResolvedValue(UPDATE);
    otaMocks.applyForcedUpdate.mockRejectedValue(new Error('network'));
  });

  it('offers a retry that runs the update again', async () => {
    renderGate();

    expect(await screen.findByText('Update failed')).toBeTruthy();
    const retry = screen.getByRole('button', { name: /try again/i });

    otaMocks.applyForcedUpdate.mockImplementation(neverResolves);
    fireEvent.click(retry);

    await waitFor(() => expect(otaMocks.applyForcedUpdate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Updating TimeHuddle')).toBeTruthy();
  });

  it('still offers no way past the gate', async () => {
    renderGate();
    await screen.findByText('Update failed');

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toMatch(/try again/i);
  });
});

// set() reloads the WebView, so applyForcedUpdate normally never resolves.
// If it does, the user must not be left watching a finished progress bar.
describe('when the WebView does not reload after the update', () => {
  it('reports restarting, then falls back to the retry', async () => {
    vi.useFakeTimers();
    otaMocks.checkForcedUpdate.mockResolvedValue(UPDATE);
    otaMocks.applyForcedUpdate.mockResolvedValue(undefined);

    renderGate();

    await vi.waitFor(() => expect(screen.getByText(/Restarting TimeHuddle/i)).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();

    await vi.advanceTimersByTimeAsync(15000);

    await vi.waitFor(() => expect(screen.getByText('Update failed')).toBeTruthy());
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});
