/**
 * AttachmentBar — the composer's Photo / Video / Doc file pickers. A picked
 * file goes to the host (`onFiles`), which stages it as a tile that uploads in
 * place and shows its own progress (useComposerUploads), so the pickers stay
 * free for the next file meanwhile.
 */
import { ComposerChipButton } from './ComposerChipButton';
import { useRef } from 'react';
import { VIDEO_FILE_ACCEPT } from '../pulse-upload/videoFile';

type FileKind = 'photo' | 'video' | 'doc';

interface AttachmentBarProps {
  /** Called with each picked file, to stage and upload. */
  onFiles: (files: File[]) => void;
}

export function AttachmentBar({ onFiles }: AttachmentBarProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => onFiles([file]);

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
          if (file) handleFileSelect(file);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        className="hidden"
        aria-label="Choose a video to attach"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
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
          if (file) handleFileSelect(file);
          e.target.value = '';
        }}
      />

      {buttons.map(({ kind, label, inputRef, icon }) => (
        <ComposerChipButton
          key={kind}
          onClick={() => inputRef.current?.click()}
          leftIcon={
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
            </svg>
          }
        >
          {label}
        </ComposerChipButton>
      ))}
    </>
  );
}
