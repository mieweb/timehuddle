/**
 * WhatsNewBanner — a dismissible "Huddle got updated" nudge.
 *
 * Shown while the user has release notes they have not read (the same set the
 * account menu badge counts), as a strip between the header and the page.
 *
 * Closing it, or opening the notes, marks the newest release as seen on the
 * user — the same marker the What's New page writes — so it stays closed on
 * every device and the account menu badge clears with it.
 */
import { Alert, AlertDescription, AlertTitle, Button, SparkleIcon } from '@mieweb/ui';
import React, { useCallback, useMemo } from 'react';

import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';
import { releaseNotes, unseenReleaseNotes, type ReleaseNote } from './notes';

const RELEASE_NOTES_PATH = '/app/release-notes';

interface WhatsNew {
  /** The newest unread release, or null when there is nothing to announce. */
  latest: ReleaseNote | null;
  open: () => void;
  dismiss: () => void;
}

function useWhatsNew(): WhatsNew {
  const { user, markReleaseNotesSeen } = useSession();
  const { navigate } = useRouter();

  const latest = useMemo(
    () =>
      unseenReleaseNotes(releaseNotes, user?.releaseNotesSeenVersion, user?.createdAt)[0] ?? null,
    [user?.createdAt, user?.releaseNotesSeenVersion],
  );

  // The page marks the notes seen when it mounts, so opening it hides the banner.
  const open = useCallback(() => navigate(RELEASE_NOTES_PATH), [navigate]);

  const dismiss = useCallback(() => {
    if (releaseNotes[0]) void markReleaseNotesSeen(releaseNotes[0].version);
  }, [markReleaseNotesSeen]);

  return { latest, open, dismiss };
}

interface WhatsNewCardProps extends WhatsNew {
  latest: ReleaseNote;
}

const WhatsNewCard: React.FC<WhatsNewCardProps> = ({ latest, open, dismiss }) => (
  <Alert
    variant="info"
    role="status"
    icon={<SparkleIcon className="h-4 w-4" aria-hidden="true" />}
    dismissible
    onDismiss={dismiss}
    dismissLabel="Dismiss what’s new"
    className="whats-new-card shadow-sm"
  >
    <AlertTitle className="text-sm">Huddle got updated! 🎉</AlertTitle>
    <AlertDescription className="whats-new-headline line-clamp-2 text-xs opacity-80">
      {latest.title}
    </AlertDescription>
    <Button
      variant="link"
      size="sm"
      onClick={open}
      className="whats-new-open mt-1.5 h-auto p-0 text-xs font-semibold"
    >
      See what’s new →
    </Button>
  </Alert>
);

export const WhatsNewBanner: React.FC = () => {
  const whatsNew = useWhatsNew();
  if (!whatsNew.latest) return null;
  return (
    <div className="whats-new-banner shrink-0 px-4 pt-3">
      <WhatsNewCard {...whatsNew} latest={whatsNew.latest} />
    </div>
  );
};
