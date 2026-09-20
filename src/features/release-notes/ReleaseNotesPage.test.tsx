import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { releaseNotes } from './notes';
import { ReleaseNotesPage } from './ReleaseNotesPage';

const markReleaseNotesSeen = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
}));

vi.mock('../../lib/useSession', () => ({
  useSession: () => ({ user: session.user, markReleaseNotesSeen }),
}));

const newest = releaseNotes[0];

/** A user who signed up long before any release, so nothing is filtered out. */
function signedInAs(overrides: Record<string, unknown> = {}) {
  session.user = {
    id: 'u1',
    createdAt: '2000-01-01T00:00:00.000Z',
    releaseNotesSeenVersion: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  markReleaseNotesSeen.mockClear();
  session.user = null;
});

describe('ReleaseNotesPage', () => {
  it('renders every bundled release', () => {
    signedInAs({ releaseNotesSeenVersion: newest.version });
    render(<ReleaseNotesPage />);

    for (const note of releaseNotes) {
      expect(screen.getByRole('heading', { level: 2, name: note.title })).toBeTruthy();
    }
    expect(screen.getAllByRole('article')).toHaveLength(releaseNotes.length);
  });

  describe('when there are unread releases', () => {
    it('flags them and says how many', async () => {
      signedInAs();
      render(<ReleaseNotesPage />);

      expect(screen.getByText(/new release(s)? since your last visit/)).toBeTruthy();
      const flags = screen.getAllByText('New', { selector: 'span' });
      expect(flags.length).toBe(releaseNotes.length);
    });

    it('records the newest version as read', async () => {
      signedInAs();
      render(<ReleaseNotesPage />);

      await waitFor(() => expect(markReleaseNotesSeen).toHaveBeenCalledWith(newest.version));
    });

    it('keeps the flags visible while the page is being read', async () => {
      signedInAs();
      const { rerender } = render(<ReleaseNotesPage />);
      await waitFor(() => expect(markReleaseNotesSeen).toHaveBeenCalled());

      // The marker write updates the session; the flags must not vanish under
      // the reader mid-page.
      session.user = { ...session.user, releaseNotesSeenVersion: newest.version };
      rerender(<ReleaseNotesPage />);

      expect(screen.getByText(/new release(s)? since your last visit/)).toBeTruthy();
    });
  });

  describe('when everything has been read', () => {
    it('shows no flags and no summary', () => {
      signedInAs({ releaseNotesSeenVersion: newest.version });
      render(<ReleaseNotesPage />);

      expect(screen.queryByText(/new release(s)? since your last visit/)).toBeNull();
      expect(screen.queryAllByText('New', { selector: 'span' })).toHaveLength(0);
    });

    it('does not write the marker again', () => {
      signedInAs({ releaseNotesSeenVersion: newest.version });
      render(<ReleaseNotesPage />);

      expect(markReleaseNotesSeen).not.toHaveBeenCalled();
    });
  });

  it('tells a brand-new account nothing is new', () => {
    // Signed up after the newest release shipped — it has only ever known the
    // app as it is now.
    signedInAs({ createdAt: '2099-01-01T00:00:00.000Z' });
    render(<ReleaseNotesPage />);

    expect(screen.queryByText(/new release(s)? since your last visit/)).toBeNull();
    expect(screen.queryAllByText('New', { selector: 'span' })).toHaveLength(0);
  });
});
