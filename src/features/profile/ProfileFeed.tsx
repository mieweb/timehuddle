import { faImage, faTrash, faVideo } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Card, Spinner, Text } from '@mieweb/ui';
import * as tus from 'tus-js-client';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { mediaApi, TIMECORE_BASE_URL, sessionToken, videoApi, type MediaItem } from '../../lib/api';
import { useSession } from '../../lib/useSession';

// ─── Upload helpers ───────────────────────────────────────────────────────────

async function uploadFileToLibrary(file: File, onProgress: (pct: number) => void): Promise<void> {
  const { videoid } = await videoApi.reserveForLibrary();

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${TIMECORE_BASE_URL.replace(/\/$/, '')}/v1/video/upload`,
      retryDelays: [0, 3000, 5000],
      metadata: { videoid, filename: file.name, filetype: file.type },
      headers: sessionToken.get() ? { Authorization: `Bearer ${sessionToken.get()}` } : {},
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
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface MediaCardProps {
  item: MediaItem;
  isOwn: boolean;
  onDelete: (id: string) => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ item, isOwn, onDelete }) => {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await mediaApi.remove(item.id);
      onDelete(item.id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card padding="none" className="overflow-hidden">
      {item.type === 'video' ? (
        <video
          src={item.url}
          controls
          playsInline
          className="w-full max-h-72 bg-black object-contain"
          aria-label={item.title ?? 'Video'}
        />
      ) : (
        <img
          src={item.url}
          alt={item.altText ?? item.title ?? 'Media'}
          className="w-full max-h-72 object-cover"
        />
      )}
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
        {isOwn && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete media item"
            disabled={deleting}
            onClick={handleDelete}
          >
            <FontAwesomeIcon icon={faTrash} className="text-red-400" />
          </Button>
        )}
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
  const { user: _sessionUser } = useSession();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mediaApi.list(userId);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleVideoFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    try {
      await uploadFileToLibrary(file, setUploadProgress);
      // Poll briefly for the new item to appear
      await new Promise((r) => setTimeout(r, 1500));
      await fetchItems();
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
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
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Upload video to library"
            leftIcon={<FontAwesomeIcon icon={faVideo} />}
            disabled={uploadProgress !== null}
            onClick={() => videoInputRef.current?.click()}
          >
            Upload Video
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Upload image to library"
            leftIcon={<FontAwesomeIcon icon={faImage} />}
            disabled={uploadProgress !== null}
            onClick={() => imageInputRef.current?.click()}
          >
            Upload Image
          </Button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) handleVideoFile(file);
            }}
          />
          {/* Image upload — placeholder for future implementation */}
          <input ref={imageInputRef} type="file" accept="image/*" className="hidden" />
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
            <MediaCard key={item.id} item={item} isOwn={isOwn} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
};
