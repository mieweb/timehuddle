/**
 * AttachmentBar — the composer's Photo / Video / Doc file pickers.
 *
 * Upload progress is reported to the host (via `onUploadProgress`) rather than
 * rendered here: the composer shows a single bar covering every phase of
 * posting, so a slow video upload reads the same as a slow post instead of
 * looking like a dead button. The pressed button still shows its own spinner
 * so it's obvious *which* attachment is in flight.
 */
import { useRef, useState } from 'react';
import { useAttachmentUpload } from './useAttachmentUpload';
import type { MediaItem } from './types';

type FileKind = 'photo' | 'video' | 'doc';

interface AttachmentBarProps {
  onAttachmentAdd: (media: MediaItem) => void;
  /**
   * Called with the in-flight upload's completed fraction (0–1), then `null`
   * once it settles (success or failure).
   */
  onUploadProgress?: (fraction: number | null) => void;
}

const BUTTON_CLASS =
  'flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function AttachmentBar({ onAttachmentAdd, onUploadProgress }: AttachmentBarProps) {
  const [uploadingKind, setUploadingKind] = useState<FileKind | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const { upload } = useAttachmentUpload({ onAttachmentAdd, onUploadProgress });

  // `uploadingKind` is tracked here rather than in the hook so the pressed
  // button — and only that button — shows its own spinner.
  const handleFileSelect = async (file: File, fileKind: FileKind) => {
    setUploadingKind(fileKind);
    try {
      await upload([file]);
    } finally {
      setUploadingKind(null);
    }
  };

  const uploading = uploadingKind !== null;

  const buttons: Array<{
    kind: FileKind;
    label: string;
    inputRef: React.RefObject<HTMLInputElement | null>;
    icon: string;
  }> = [
    {
      kind: 'photo',
      label: 'Photo',
      inputRef: photoInputRef,
      icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    },
    {
      kind: 'video',
      label: 'Video',
      inputRef: videoInputRef,
      icon: 'M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    },
    {
      kind: 'doc',
      label: 'Doc',
      inputRef: docInputRef,
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    },
  ];

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose a photo to attach"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file, 'photo');
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        aria-label="Choose a video to attach"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file, 'video');
          e.target.value = '';
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        className="hidden"
        aria-label="Choose a document to attach"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file, 'doc');
          e.target.value = '';
        }}
      />

      {buttons.map(({ kind, label, inputRef, icon }) => {
        const isUploading = uploadingKind === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            // No aria-label: the visible text ("Photo" / "Uploading…") is
            // already the accessible name, and aria-busy carries the state.
            aria-busy={isUploading}
            className={BUTTON_CLASS}
          >
            {isUploading ? (
              <Spinner />
            ) : (
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
            )}
            {isUploading ? 'Uploading…' : label}
          </button>
        );
      })}
    </>
  );
}
