/**
 * MediaPage — WordPress-style media library.
 *
 * • Responsive thumbnail grid (images + videos).
 * • Click any item to open a slide-out details drawer on the right.
 * • Drawer shows a preview, file info, and editable metadata (title, caption, alt text).
 * • Upload button at top accepts images and .mp4 videos.
 */
import {
  faCheck,
  faCopy,
  faFileVideo,
  faImage,
  faTrash,
  faUpload,
  faVideo,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input, Spinner, Text, Textarea } from '@mieweb/ui';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

import { mediaApi, videoApi, type MediaItem } from '../../lib/api';
import { MEDIA_UPLOAD_ACCEPT, useFileUploadLauncher } from '../../lib/useFileUploadLauncher';
import { extractVideoThumbnail, extractThumbnailFromVideoUrl } from '../../lib/videoThumbnail';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { ViewportOverlay } from '../../ui/ViewportOverlay';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

async function uploadVideoToLibrary(file: File, onProgress: (pct: number) => void): Promise<void> {
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
      onSuccess: () => resolve(),
      onError: (err) => reject(err),
    });
    upload.start();
  });
}

// ─── Thumbnail grid item ──────────────────────────────────────────────────────

const GridItem: React.FC<{
  item: MediaItem;
  selected: boolean;
  onClick: () => void;
}> = ({ item, selected, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Open details for ${item.title ?? item.filename}`}
    aria-pressed={selected}
    className={[
      'group relative aspect-[4/3] overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800',
      'focus:outline-none focus:ring-2 focus:ring-[var(--mieweb-primary-500)]',
      'transition-transform hover:scale-[1.02]',
      selected ? 'ring-2 ring-[var(--mieweb-primary-500)]' : '',
    ].join(' ')}
  >
    {item.type === 'video' ? (
      item.thumbnail ? (
        <img src={item.thumbnail} alt={item.title ?? ''} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FontAwesomeIcon icon={faFileVideo} className="text-3xl text-neutral-400" />
        </div>
      )
    ) : (
      <img
        src={item.url}
        alt={item.altText ?? item.title ?? ''}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    )}

    {/* Video badge */}
    {item.type === 'video' && (
      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        <FontAwesomeIcon icon={faVideo} className="mr-1" />
        MP4
      </span>
    )}

    {/* Selection overlay */}
    {selected && (
      <div className="absolute inset-0 bg-[var(--mieweb-primary-500)]/20 flex items-start justify-end p-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--mieweb-primary-500)]">
          <FontAwesomeIcon icon={faCheck} className="text-[10px] text-white" />
        </span>
      </div>
    )}
  </button>
);

// ─── Details modal ────────────────────────────────────────────────────────────

interface DetailsModalProps {
  item: MediaItem;
  open: boolean;
  onClose: () => void;
  onUpdated: (updated: MediaItem) => void;
  onDeleted: (id: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  canGoPrevious: boolean;
  canGoNext: boolean;
}

const DetailsModal: React.FC<DetailsModalProps> = ({
  item,
  open,
  onClose,
  onUpdated,
  onDeleted,
  onPrevious,
  onNext,
  canGoPrevious,
  canGoNext,
}) => {
  const [title, setTitle] = useState(item.title ?? '');
  const [caption, setCaption] = useState(item.caption ?? '');
  const [altText, setAltText] = useState(item.altText ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generatingThumb, setGeneratingThumb] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setTitle(item.title ?? '');
    setCaption(item.caption ?? '');
    setAltText(item.altText ?? '');
    setSaved(false);
  }, [item.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await mediaApi.update(item.id, { title, caption, altText });
      onUpdated(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this media item? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await mediaApi.remove(item.id);
      onDeleted(item.id);
    } finally {
      setDeleting(false);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(item.url).catch(() => {});
  };

  const handleGenerateThumbnail = async () => {
    setGeneratingThumb(true);
    try {
      const previewTime =
        previewVideoRef.current && previewVideoRef.current.readyState > 0
          ? previewVideoRef.current.currentTime
          : undefined;
      const blob = await extractThumbnailFromVideoUrl(item.url, previewTime);
      const updated = await mediaApi.uploadThumbnail(item.id, blob);
      onUpdated(updated);
    } finally {
      setGeneratingThumb(false);
    }
  };

  return (
    <ViewportOverlay
      open={open}
      title="Media details"
      onClose={onClose}
      onPrevious={onPrevious}
      onNext={onNext}
      canGoPrevious={canGoPrevious}
      canGoNext={canGoNext}
      ariaLabel="Media details"
    >
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex h-full min-h-0 flex-col bg-neutral-950">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {item.type === 'video' ? (
              <video
                ref={previewVideoRef}
                src={item.url}
                controls
                playsInline
                className="max-h-full w-full object-contain"
                aria-label={item.title ?? 'Video preview'}
              />
            ) : (
              <img
                src={item.url}
                alt={item.altText ?? item.title ?? ''}
                className="max-h-full w-full object-contain"
              />
            )}
          </div>

          {item.type === 'video' && (
            <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt="Thumbnail"
                  className="h-8 w-14 rounded object-cover bg-neutral-800"
                />
              )}
              <Button
                size="sm"
                variant="secondary"
                disabled={generatingThumb}
                onClick={handleGenerateThumbnail}
                aria-label="Generate thumbnail from video midpoint"
              >
                {generatingThumb
                  ? 'Generating…'
                  : item.thumbnail
                    ? 'Regenerate Thumbnail'
                    : 'Generate Thumbnail'}
              </Button>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto border-t border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900 md:border-l md:border-t-0">
          <div className="space-y-5">
            <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-500 space-y-1 dark:bg-neutral-800/60 dark:text-neutral-400">
              <div className="flex justify-between gap-3">
                <span>File name</span>
                <span className="max-w-[55%] truncate text-right text-neutral-700 dark:text-neutral-300">
                  {item.filename}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Type</span>
                <span className="text-neutral-700 dark:text-neutral-300">{item.mimeType}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Size</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {formatBytes(item.size)}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Uploaded</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {formatDate(item.uploadedAt)}
                </span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                File URL
              </label>
              <div className="relative">
                <Input
                  readOnly
                  value={item.url}
                  className="min-w-0 pr-11 text-xs"
                  aria-label="File URL"
                  onFocus={(e) => e.target.select()}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyUrl}
                  aria-label="Copy URL"
                  className="absolute right-1.5 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                  title="Copy URL"
                >
                  <FontAwesomeIcon icon={faCopy} />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="media-title"
                  className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500"
                >
                  Title
                </label>
                <Input
                  id="media-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Add a title…"
                />
              </div>
              <div>
                <label
                  htmlFor="media-caption"
                  className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500"
                >
                  Caption
                </label>
                <Textarea
                  id="media-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Add a caption…"
                  rows={3}
                />
              </div>
              {item.type === 'image' && (
                <div>
                  <label
                    htmlFor="media-alt"
                    className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500"
                  >
                    Alt Text
                  </label>
                  <Input
                    id="media-alt"
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    placeholder="Describe this image for screen readers…"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                aria-label="Delete media item"
                className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
              >
                <FontAwesomeIcon icon={faTrash} className="mr-1.5" />
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                aria-label="Save metadata changes"
              >
                {saved ? (
                  <>
                    <FontAwesomeIcon icon={faCheck} className="mr-1.5 text-green-400" />
                    Saved
                  </>
                ) : saving ? (
                  'Saving…'
                ) : (
                  'Save'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ViewportOverlay>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export const MediaPage: React.FC = () => {
  const { user } = useSession();
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'video' | 'image'>('all');

  const fetchItems = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await mediaApi.list();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const filteredItems = filter === 'all' ? items : items.filter((i) => i.type === filter);

  const navigationItems =
    selectedId && filteredItems.some((item) => item.id === selectedId) ? filteredItems : items;
  const selectedIndex = navigationItems.findIndex((item) => item.id === selectedId);
  const canGoPrevious = selectedIndex > 0;
  const canGoNext = selectedIndex >= 0 && selectedIndex < navigationItems.length - 1;

  const handlePrevious = () => {
    if (!canGoPrevious) return;
    setSelectedId(navigationItems[selectedIndex - 1]?.id ?? null);
  };

  const handleNext = () => {
    if (!canGoNext) return;
    setSelectedId(navigationItems[selectedIndex + 1]?.id ?? null);
  };

  const handleMediaFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);

    try {
      if (file.type.startsWith('video/')) {
        const thumbnailPromise = extractVideoThumbnail(file).catch(() => null);

        await uploadVideoToLibrary(file, setUploadProgress);
        await new Promise((r) => setTimeout(r, 1500));

        const freshItems = await mediaApi.list();
        setItems(freshItems);

        const thumbnailBlob = await thumbnailPromise;
        if (thumbnailBlob && freshItems.length > 0) {
          const newest = freshItems[0];
          if (newest) {
            try {
              const updated = await mediaApi.uploadThumbnail(newest.id, thumbnailBlob);
              setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
            } catch {
              // Thumbnail upload failed silently — user can regenerate from the overlay.
            }
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

  const handleUpdated = (updated: MediaItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const handleDeleted = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setSelectedId(null);
  };

  return (
    <AppPage fullWidth>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Upload button */}
        <Button
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faUpload} />}
          disabled={uploadProgress !== null}
          onClick={openMediaFileDialog}
          aria-label="Upload media"
        >
          Upload
        </Button>

        {/* Hidden file input */}
        <input {...mediaInputProps} />

        {/* Upload status */}
        {uploadProgress !== null && (
          <span className="text-sm text-neutral-500">Uploading… {uploadProgress}%</span>
        )}
        {uploadError && <span className="text-sm text-red-500">{uploadError}</span>}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filter tabs */}
        <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-sm dark:border-neutral-700">
          {(['all', 'image', 'video'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={[
                'px-3 py-1.5 capitalize transition-colors',
                filter === f
                  ? 'bg-[var(--mieweb-primary-500)] text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800',
              ].join(' ')}
            >
              {f === 'all' ? 'All' : f === 'image' ? 'Images' : 'Videos'}
            </button>
          ))}
        </div>

        {/* Item count */}
        <Text variant="muted" size="sm">
          {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
        </Text>
      </div>

      {/* Main area — grid + sticky drawer */}
      <div className="flex items-start gap-4">
        {/* Grid */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Spinner size="lg" label="Loading media…" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <FontAwesomeIcon
                icon={faImage}
                className="text-4xl text-neutral-300 dark:text-neutral-600"
              />
              <Text variant="muted" size="sm">
                {filter === 'all'
                  ? 'No media yet. Upload a video or image to get started.'
                  : `No ${filter}s in your library.`}
              </Text>
            </div>
          ) : (
            <div className="grid gap-3 auto-rows-[1fr] grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {filteredItems.map((item) => (
                <GridItem
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Modal details */}
        {selectedItem && (
          <DetailsModal
            item={selectedItem}
            open={!!selectedItem}
            onClose={() => setSelectedId(null)}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onPrevious={handlePrevious}
            onNext={handleNext}
            canGoPrevious={canGoPrevious}
            canGoNext={canGoNext}
          />
        )}
      </div>
    </AppPage>
  );
};
