import { faFileVideo, faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Spinner, Text } from '@mieweb/ui';
import * as tus from 'tus-js-client';
import React, { useCallback, useEffect, useState } from 'react';

import { mediaApi, videoApi, type MediaItem } from '../../lib/api';
import { extractVideoThumbnail } from '../../lib/videoThumbnail';
import { MEDIA_UPLOAD_ACCEPT, useFileUploadLauncher } from '../../lib/useFileUploadLauncher';
import { useSession } from '../../lib/useSession';
import { ViewportOverlay } from '../../ui/ViewportOverlay';

// ─── Upload helpers ───────────────────────────────────────────────────────────

async function uploadFileToLibrary(file: File, onProgress: (pct: number) => void): Promise<string> {
  const { videoid, uploadToken } = await videoApi.reserveForLibrary();

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: [0, 3000, 5000],
      metadata: { videoid, filename: file.name, filetype: file.type },
      headers: { Authorization: `Bearer ${uploadToken}` },
      onProgress(bytesUploaded, bytesTotal) {
        onProgress(Math.round((bytesUploaded / bytesTotal) * 100));
      },
      onSuccess() {
        resolve();
      },
      onError(err) {
        reject(err);
      },
    });
    upload.start();
  });

  return videoid;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MediaCardProps {
  item: MediaItem;
  onOpen: (id: string) => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ item, onOpen }) => {
  return (
    <Card
      padding="none"
      className="overflow-hidden"
      onClick={() => onOpen(item.id)}
      role="button"
      tabIndex={0}
      aria-label={`Open ${item.title ?? item.type}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item.id);
        }
      }}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-neutral-900">
        {item.type === 'video' ? (
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

  const waitForUploadedVideo = useCallback(
    async (videoid: string): Promise<MediaItem[] | null> => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const latest = await mediaApi.listForUser(userId);
        if (latest.some((item) => item.videoid === videoid)) return latest;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    },
    [userId],
  );

  const handleMediaFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    try {
      if (file.type.startsWith('video/')) {
        // Start thumbnail extraction in parallel with the upload.
        const thumbnailPromise = extractVideoThumbnail(file).catch(() => null);

        const videoid = await uploadFileToLibrary(file, setUploadProgress);
        const freshItems = await waitForUploadedVideo(videoid);
        if (freshItems) setItems(freshItems);

        const thumbnailBlob = await thumbnailPromise;
        const uploadedVideo = freshItems?.find((item) => item.videoid === videoid);
        if (thumbnailBlob && uploadedVideo) {
          try {
            const updated = await mediaApi.uploadThumbnail(uploadedVideo.id, thumbnailBlob);
            setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
          } catch {
            // Keep the successful upload and skip thumbnail update failures.
          }
        }
        return;
      }

      const created = await mediaApi.uploadImage(file);
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

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
  const canGoPrevious = selectedIndex > 0;
  const canGoNext = selectedIndex >= 0 && selectedIndex < items.length - 1;

  const handlePrevious = () => {
    if (!canGoPrevious) return;
    setSelectedId(items[selectedIndex - 1]?.id ?? null);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    setSelectedId(items[selectedIndex + 1]?.id ?? null);
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
            {isOwn
              ? 'No media yet. Upload a video or image to get started.'
              : 'No media posted yet.'}
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
