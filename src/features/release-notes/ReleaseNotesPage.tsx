/**
 * ReleaseNotesPage — the in-app view of every release, newest first.
 *
 * The notes themselves are markdown files in `release-notes/` at the repo root,
 * bundled into this build (see `notes.ts`), so this page needs no API call and
 * works offline inside an OTA bundle.
 *
 * Anything published since the user last opened the page is flagged. That set
 * is frozen on mount before the marker is written, so the flags stay visible
 * while the page is being read rather than vanishing under the cursor.
 *
 * The same notes are readable without an account at `/release-notes`
 * (`PublicReleaseNotesPage`); the cards themselves are shared between the two.
 */
import { faBullhorn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Text } from '@mieweb/ui';
import React, { useEffect, useMemo, useState } from 'react';

import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { releaseNotes, unseenReleaseNotes } from './notes';
import { ReleaseNotesList } from './ReleaseNotesList';

export const ReleaseNotesPage: React.FC = () => {
  const { user, markReleaseNotesSeen } = useSession();
  const newest = releaseNotes[0];

  // Captured once: which notes were unread *when the page opened*. Recomputing
  // after the marker is written would clear every flag mid-read.
  const [unseenVersions] = useState(
    () =>
      new Set(
        unseenReleaseNotes(releaseNotes, user?.releaseNotesSeenVersion, user?.createdAt).map(
          (note) => note.version,
        ),
      ),
  );

  useEffect(() => {
    if (!newest || !user) return;
    if (user.releaseNotesSeenVersion === newest.version) return;
    void markReleaseNotesSeen(newest.version);
  }, [markReleaseNotesSeen, newest, user]);

  const summary = useMemo(() => {
    const count = unseenVersions.size;
    if (count === 0) return null;
    return count === 1
      ? '1 new release since your last visit'
      : `${count} new releases since your last visit`;
  }, [unseenVersions]);

  return (
    <AppPage subtitle="What has changed in TimeHuddle, newest first.">
      {summary && (
        <Text
          as="p"
          variant="primary"
          size="sm"
          weight="medium"
          className="release-notes-summary mb-4"
          role="status"
        >
          <FontAwesomeIcon icon={faBullhorn} className="me-2" aria-hidden="true" />
          {summary}
        </Text>
      )}

      <ReleaseNotesList notes={releaseNotes} unseenVersions={unseenVersions} />
    </AppPage>
  );
};
