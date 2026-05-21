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
  faFileVideo,
  faImage,
  faTrash,
  faUpload,
  faVideo,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input, Spinner, Text, Textarea } from '@mieweb/ui';
import { AnimatePresence, motion } from 'motion/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as tus from 'tus-js-client';

import { mediaApi, sessionToken, videoApi, type MediaItem } from '../../lib/api';
import { extractVideoThumbnail, extractThumbnailFromVideoUrl } from '../../lib/videoThumbnail';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';

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
  const { videoid } = await videoApi.reserveForLibrary();
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: videoApi.uploadEndpoint(),
      retryDelays: [0, 3000, 5000],
      metadata: { videoid, filename: file.name, filetype: file.type },
      headers: sessionToken.get() ? { Authorization: `Bearer ${sessionToken.get()}` } : {},
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

// ─── Details drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  item: MediaItem;
  onClose: () => void;
  onUpdated: (updated: MediaItem) => void;
  onDeleted: (id: string) => void;
}

const DetailsDrawer: React.FC<DrawerProps> = ({ item, onClose, onUpdated, onDeleted }) => {
  const [title, setTitle] = useState(item.title ?? '');
  const [caption, setCaption] = useState(item.caption ?? '');
  const [altText, setAltText] = useState(item.altText ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generatingThumb, setGeneratingThumb] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  // Reset fields when item changes
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <Text size="sm" weight="semibold" className="truncate">
          {item.title ?? item.filename}
        </Text>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details panel"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 transition-colors"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Preview */}
        <div className="bg-neutral-950 flex flex-col items-center justify-center min-h-40 max-h-64">
          {item.type === 'video' ? (
            <video
              ref={previewVideoRef}
              src={item.url}
              controls
              playsInline
              className="max-h-64 w-full object-contain"
              aria-label={item.title ?? 'Video preview'}
            />
          ) : (
            <img
              src={item.url}
              alt={item.altText ?? item.title ?? ''}
              className="max-h-64 w-full object-contain"
            />
          )}
        </div>
        {item.type === 'video' && (
          <div className="border-b border-neutral-200 dark:border-neutral-700 px-4 py-2 flex items-center gap-2">
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

        <div className="flex flex-col gap-5 p-4">
          {/* File info */}
          <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3 text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
            <div className="flex justify-between">
              <span>File name</span>
              <span className="text-neutral-700 dark:text-neutral-300 truncate max-w-[55%] text-right">
                {item.filename}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Type</span>
              <span className="text-neutral-700 dark:text-neutral-300">{item.mimeType}</span>
            </div>
            <div className="flex justify-between">
              <span>Size</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                {formatBytes(item.size)}
              </span>
            </div>
            {item.width && item.height && (
              <div className="flex justify-between">
                <span>Dimensions</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {item.width} × {item.height}
                </span>
              </div>
            )}
            {item.duration && (
              <div className="flex justify-between">
                <span>Duration</span>
                <span className="text-neutral-700 dark:text-neutral-300">
                  {Math.round(item.duration)}s
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Uploaded</span>
              <span className="text-neutral-700 dark:text-neutral-300">
                {formatDate(item.uploadedAt)}
              </span>
            </div>
          </div>

          {/* URL copy */}
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 uppercase tracking-wider">
              File URL
            </label>
            <div className="flex gap-2">
              <input
                readOnly
                value={item.url}
                className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
                aria-label="File URL"
                onFocus={(e) => e.target.select()}
              />
              <Button size="sm" variant="secondary" onClick={copyUrl} aria-label="Copy URL">
                Copy
              </Button>
            </div>
          </div>

          {/* Editable fields */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor="media-title"
                className="mb-1 block text-xs font-medium text-neutral-500 uppercase tracking-wider"
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
                className="mb-1 block text-xs font-medium text-neutral-500 uppercase tracking-wider"
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
                  className="mb-1 block text-xs font-medium text-neutral-500 uppercase tracking-wider"
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
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t border-neutral-200 dark:border-neutral-700 px-4 py-3 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={deleting}
          aria-label="Delete media item"
          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
        >
          <FontAwesomeIcon icon={faTrash} className="mr-1.5" />
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} aria-label="Save metadata changes">
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

  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<number | null>(null);

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

  useEffect(() => {
    if (!selectedItem) {
      setDrawerHeight(null);
      return;
    }

    const recomputeDrawerHeight = () => {
      const el = drawerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const bottomGap = 16;
      const minHeight = 320;
      const next = Math.max(minHeight, Math.floor(window.innerHeight - top - bottomGap));
      setDrawerHeight((prev) => (prev === next ? prev : next));
    };

    const onViewportChange = () => {
      requestAnimationFrame(recomputeDrawerHeight);
    };

    recomputeDrawerHeight();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, { passive: true });

    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange);
    };
  }, [selectedItem]);

  const handleVideoFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    let freshItems: MediaItem[] = [];
    try {
      // Extract thumbnail client-side (seeks to middle) before the network upload
      // so we have it ready as soon as the upload completes.
      const thumbnailPromise = extractVideoThumbnail(file).catch(() => null);

      await uploadVideoToLibrary(file, setUploadProgress);

      // Give the backend a moment to persist the media record
      await new Promise((r) => setTimeout(r, 1500));
      freshItems = await mediaApi.list();
      setItems(freshItems);

      // Upload the thumbnail separately — failures here don't affect the upload banner
      const thumbnailBlob = await thumbnailPromise;
      if (thumbnailBlob && freshItems.length > 0) {
        const newest = freshItems[0];
        if (newest) {
          try {
            const updated = await mediaApi.uploadThumbnail(newest.id, thumbnailBlob);
            setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
          } catch {
            // Thumbnail upload failed silently — user can regenerate from the drawer
          }
        }
      }
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadProgress(null);
    }
  };

  const handleImageFile = async (file: File) => {
    setUploadError(null);
    setUploadProgress(0);
    try {
      const created = await mediaApi.uploadImage(file);
      setItems((prev) => [created, ...prev]);
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploadProgress(null);
    }
  };

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
        {/* Upload buttons */}
        <Button
          size="sm"
          leftIcon={<FontAwesomeIcon icon={faUpload} />}
          disabled={uploadProgress !== null}
          onClick={() => videoInputRef.current?.click()}
          aria-label="Upload video"
        >
          Upload Video
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<FontAwesomeIcon icon={faImage} />}
          disabled={uploadProgress !== null}
          onClick={() => imageInputRef.current?.click()}
          aria-label="Upload image"
        >
          Upload Image
        </Button>

        {/* Hidden file inputs */}
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
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleImageFile(file);
          }}
        />

        {/* Upload status */}
        {uploadProgress !== null && (
          <span className="text-sm text-neutral-500">Uploading… {uploadProgress}%</span>
        )}
        {uploadError && <span className="text-sm text-red-500">{uploadError}</span>}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filter tabs */}
        <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden text-sm">
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

        {/* Sticky drawer — scrolls with page, sticks in view */}
        <AnimatePresence>
          {selectedItem && (
            <motion.aside
              ref={drawerRef}
              key="media-drawer"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ type: 'spring', stiffness: 340, damping: 32 }}
              className="w-80 shrink-0 sticky top-4 min-h-0 rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900 shadow-xl overflow-hidden flex flex-col"
              style={drawerHeight ? { height: `${drawerHeight}px` } : undefined}
              aria-label="Media details"
            >
              <DetailsDrawer
                item={selectedItem}
                onClose={() => setSelectedId(null)}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </AppPage>
  );
};
