/**
 * ReleaseNotesList — the releases themselves, newest first.
 *
 * Shared by the two places notes are read: the in-app page at
 * `/app/release-notes`, which knows who you are and can flag what is unread,
 * and the public page at `/release-notes`, which does not. Keeping the cards in
 * one component means a note renders identically whether or not anyone is
 * signed in.
 */
import { faBullhorn } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Card, CardContent, CardHeader, CardTitle, Text } from '@mieweb/ui';
import React from 'react';

import { EmptyState } from '../../ui/EmptyState';
import { MarkdownContent } from '../../ui/MarkdownContent';
import type { ReleaseNote } from './parse';

/** "19 September 2026" in the reader's locale, from a `YYYY-MM-DD` string. */
export function formatReleaseDate(date: string): string {
  // Parsed as local, not UTC — `new Date('2026-09-19')` is midnight UTC, which
  // renders as the previous day for anyone behind it.
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

interface ReleaseNotesListProps {
  notes: ReleaseNote[];
  /**
   * Versions to flag as unread. Empty for a reader we know nothing about —
   * the public page has no one to personalise for.
   */
  unseenVersions?: ReadonlySet<string>;
}

export const ReleaseNotesList: React.FC<ReleaseNotesListProps> = ({
  notes,
  unseenVersions = new Set<string>(),
}) => {
  if (notes.length === 0) {
    return (
      <EmptyState
        icon={<FontAwesomeIcon icon={faBullhorn} />}
        title="No release notes yet"
        description="Notes for each release will appear here once one has been published."
      />
    );
  }

  return (
    <ol className="release-notes-list list-none space-y-6 p-0">
      {notes.map((note) => {
        const headingId = `release-${note.version}`;
        return (
          <li key={note.version}>
            <Card as="article" aria-labelledby={headingId}>
              <CardHeader>
                <div className="release-notes-heading flex flex-wrap items-center gap-2">
                  <CardTitle as="h2" id={headingId}>
                    {note.title}
                  </CardTitle>
                  {unseenVersions.has(note.version) && (
                    <Badge variant="success" size="sm">
                      New
                    </Badge>
                  )}
                </div>
                <Text as="p" variant="muted" size="sm" className="mt-1">
                  Version {note.version} ·{' '}
                  <time dateTime={note.date}>{formatReleaseDate(note.date)}</time>
                </Text>
              </CardHeader>
              <CardContent>
                <MarkdownContent
                  content={note.body}
                  // Notes are files wrapped to a column, not chat messages — a
                  // newline mid-sentence is wrapping, not a line break.
                  hardBreaks={false}
                  // Screenshots are written at whatever size they were captured;
                  // scope them to the card rather than teaching the shared
                  // renderer a rule only this page needs.
                  className="release-notes-body [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-neutral-200 dark:[&_img]:border-neutral-700"
                />
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );
};
