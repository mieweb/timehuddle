import { faFileLines, faFileVideo, faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { mediaApi, type MediaItem } from '../../lib/api';
import { MEDIA_UPLOAD_ACCEPT, useFileUploadLauncher } from '../../lib/useFileUploadLauncher';
import { useSession } from '../../lib/useSession';
import { ViewportOverlay } from '../../ui/ViewportOverlay';

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MediaCardProps {
  item: MediaItem;
  onOpen: (id: string) => void;
}

/** Where a library item was used, when it isn't a plain library upload. */
function sourceLabel(item: MediaItem): string | null {
  if (item.source?.kind === 'ticket') return 'On a ticket';
  if (item.source?.kind === 'clock') return 'On a clock session';
  return null;
}

/** Documents open in a new tab; images and videos open in the viewer. */
function openItem(item: MediaItem, onOpen: (id: string) => void) {
  if (item.type === 'document') window.open(item.url, '_blank', 'noopener,noreferrer');
  else onOpen(item.id);
}

const MediaCard: React.FC<MediaCardProps> = ({ item, onOpen }) => {
  const source = sourceLabel(item);
  return (
    <Card
      padding="none"
      className="overflow-hidden"
      onClick={() => openItem(item, onOpen)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${item.title ?? item.type}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openItem(item, onOpen);
        }
      }}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-900">
        {item.type === 'document' ? (
          <div className="media-card-document flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-neutral-300">
            <FontAwesomeIcon icon={faFileLines} className="text-4xl" aria-hidden="true" />
            <Text size="xs" className="max-w-full truncate text-neutral-300">
              {item.title ?? item.filename}
            </Text>
          </div>
        ) : item.type === 'video' ? (
          item.thumbnail ? (
            <img
              src={item.thumbnail}
              alt={item.title ?? 'Video thumbnail'}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-400">
              <FontAwesomeIcon icon={faFileVideo} className="text-4xl" />
            </div>
          )
        ) : (
          <img
            src={item.url}
            alt={item.altText ?? item.title ?? 'Media'}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          {item.title && (
            <Text size="sm" weight="medium" className="truncate">
              {item.title}
            </Text>
          )}
          {item.caption && (
            <Text variant="muted" size="xs" className="truncate">
              {item.caption}
            </Text>
          )}
          <Text variant="muted" size="xs">
            {new Date(item.uploadedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {source && ` · ${source}`}
          </Text>
        </div>
      </div>
    </Card>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface ProfileFeedProps {
  userId: string;
  isOwn: boolean;
}

export const ProfileFeed: React.FC<ProfileFeedProps> = ({ userId, isOwn }) => {
  useSession();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mediaApi.listForUser(userId);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Images only: videos reach a profile's library through Pulse (recorded from
  // a Huddle or Clock post), since PulseVault is built for the Pulse app and a
  // general video upload endpoint doesn't exist yet.
  const handleMediaFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    try {
      const created = await mediaApi.uploadImage(file, (fraction) =>
        setUploadProgress(Math.round(fraction * 100)),
      );
      setItems((prev) => [created, ...prev]);
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadProgress(null);
    }
  };

  const { inputProps: mediaInputProps, openFileDialog: openMediaFileDialog } =
    useFileUploadLauncher({
      accept: MEDIA_UPLOAD_ACCEPT,
      onFile: handleMediaFile,
    });

  // The viewer steps through images and videos only; documents open in a tab.
  const viewable = items.filter((item) => item.type !== 'document');
  const selectedItem = viewable.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = selectedId ? viewable.findIndex((item) => item.id === selectedId) : -1;
  const canGoPrevious = selectedIndex > 0;
  const canGoNext = selectedIndex >= 0 && selectedIndex < viewable.length - 1;

  const handlePrevious = () => {
    if (!canGoPrevious) return;
    setSelectedId(viewable[selectedIndex - 1]?.id ?? null);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    setSelectedId(viewable[selectedIndex + 1]?.id ?? null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" label="Loading feed…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Upload controls — own profile only */}
      {isOwn && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Upload media to library"
            leftIcon={<FontAwesomeIcon icon={faUpload} />}
            disabled={uploadProgress !== null}
            onClick={openMediaFileDialog}
          >
            Upload
          </Button>
          <input {...mediaInputProps} />
          {uploadProgress !== null && (
            <Text variant="muted" size="sm">
              Uploading… {uploadProgress}%
            </Text>
          )}
          {uploadError && (
            <Text size="sm" className="text-red-500">
              {uploadError}
            </Text>
          )}
        </div>
      )}

      {/* Feed items */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Text variant="muted" size="sm">
            {isOwn ? 'No media yet. Upload an image to get started.' : 'No media posted yet.'}
          </Text>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} onOpen={setSelectedId} />
          ))}
        </div>
      )}

      {selectedItem && (
        <ViewportOverlay
          open={!!selectedItem}
          title={selectedItem.title ?? 'Media'}
          onClose={() => setSelectedId(null)}
          onPrevious={handlePrevious}
          onNext={handleNext}
          canGoPrevious={canGoPrevious}
          canGoNext={canGoNext}
          ariaLabel={selectedItem.title ?? 'Media viewer'}
        >
          <div className="flex h-full min-h-0 items-center justify-center bg-black">
            {selectedItem.type === 'video' ? (
              <video
                src={selectedItem.url}
                controls
                autoPlay
                playsInline
                className="h-full w-full object-contain"
                aria-label={selectedItem.title ?? 'Video preview'}
              />
            ) : (
              <img
                src={selectedItem.url}
                alt={selectedItem.altText ?? selectedItem.title ?? 'Media'}
                className="h-full w-full object-contain"
              />
            )}
          </div>
        </ViewportOverlay>
      )}
    </div>
  );
};
