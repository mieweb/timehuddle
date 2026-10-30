/**
 * VideoNameEditor — one of your own videos' name, edited in place, where the
 * name shows (a card's caption, the media view's actions beside its title), as
 * a message is edited in Huddle: Enter or Save keeps it, Escape or Cancel
 * leaves it. A video has one name (on its media item), so the new one shows
 * everywhere it appears. Empty clears it, and the video is called by its id
 * again.
 */
import { Button, ButtonGroup, Input, Text } from '@mieweb/ui';
import React, { useState } from 'react';
import { videoApi } from '@lib/api';
import { noteRenamed } from './videoNames';

/** Longest name the server keeps (VIDEO_NAME_MAX in meteor-backend/server/video-names-core.js). */
export const VIDEO_NAME_MAX = 120;

/** User-facing copy, kept together for translation. */
export const NAME_EDITOR_COPY = {
  label: 'Video name',
  failed: "The name wasn't saved. Try again.",
  save: 'Save',
  cancel: 'Cancel',
};

interface VideoNameEditorProps {
  /** The video's PulseVault id. */
  video: string;
  /** Its name now (null: none). */
  name: string | null;
  /**
   * Editing is over: with the name the server kept (null: none) after a save,
   * or `undefined` when it was cancelled.
   */
  onDone: (renamed?: string | null) => void;
  className?: string;
}

export function VideoNameEditor({ video, name, onDone, className = '' }: VideoNameEditorProps) {
  const [value, setValue] = useState(name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const renamed = await videoApi.rename(video, value);
      noteRenamed(video, renamed);
      onDone(renamed);
    } catch {
      setError(NAME_EDITOR_COPY.failed);
      setSaving(false);
    }
  };

  return (
    // Dark, like the video it sits on. Its keys and taps stay its own: Escape
    // doesn't also leave the media view, and a tap doesn't play the video.
    <form
      data-theme="dark"
      className={`video-name-editor flex flex-col gap-2 ${className}`}
      onSubmit={save}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onDone();
      }}
    >
      <Input
        aria-label={NAME_EDITOR_COPY.label}
        size="sm"
        value={value}
        maxLength={VIDEO_NAME_MAX}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setValue(event.target.value)}
      />
      {error && (
        <Text size="sm" className="text-red-300" role="alert">
          {error}
        </Text>
      )}
      <ButtonGroup className="justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone()} disabled={saving}>
          {NAME_EDITOR_COPY.cancel}
        </Button>
        <Button type="submit" size="sm" variant="primary" isLoading={saving}>
          {NAME_EDITOR_COPY.save}
        </Button>
      </ButtonGroup>
    </form>
  );
}
