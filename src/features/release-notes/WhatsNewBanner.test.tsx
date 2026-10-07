/**
 * The banner shows only while the user has unread notes, and both of its
 * actions end with the newest release marked as seen.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../ui/router', () => ({ useRouter: vi.fn() }));

import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';
import { releaseNotes } from './notes';
import { WhatsNewBanner } from './WhatsNewBanner';

const navigate = vi.fn();
const markReleaseNotesSeen = vi.fn(async () => {});
const newest = releaseNotes[0]!;

function signInAs(releaseNotesSeenVersion: string | null) {
  vi.mocked(useSession).mockReturnValue({
    user: { releaseNotesSeenVersion, createdAt: '2020-01-01T00:00:00Z' },
    markReleaseNotesSeen,
  } as unknown as ReturnType<typeof useSession>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useRouter).mockReturnValue({ navigate } as unknown as ReturnType<typeof useRouter>);
});

afterEach(cleanup);

describe('WhatsNewBanner', () => {
  it('announces the newest unread release', () => {
    signInAs('0.0.1');
    render(<WhatsNewBanner placement="mobile" />);
    expect(screen.getByText('Huddle got updated! 🎉')).toBeTruthy();
    expect(screen.getByText(newest.title)).toBeTruthy();
  });

  it('renders nothing once the newest release has been seen', () => {
    signInAs(newest.version);
    const { container } = render(<WhatsNewBanner placement="mobile" />);
    expect(container.innerHTML).toBe('');
  });

  it('marks the newest release seen when closed', () => {
    signInAs('0.0.1');
    render(<WhatsNewBanner placement="sidebar" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss what’s new' }));
    expect(markReleaseNotesSeen).toHaveBeenCalledWith(newest.version);
  });

  it('opens the release notes from the collapsed rail', () => {
    signInAs('0.0.1');
    render(<WhatsNewBanner placement="sidebar" collapsed />);
    fireEvent.click(screen.getByRole('button', { name: /see what’s new/i }));
    expect(navigate).toHaveBeenCalledWith('/app/release-notes');
  });
});
