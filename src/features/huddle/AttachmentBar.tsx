/**
 * AttachmentBar — the composer's one Media picker: photos, videos and
 * documents from a single file chooser. A picked file goes to the host
 * (`onFiles`), which stages it as a tile that uploads in place and shows its
 * own progress (useComposerUploads), so the picker stays free meanwhile.
 */
import { ComposerChipButton } from './ComposerChipButton';
import { useRef } from 'react';
import { VIDEO_FILE_ACCEPT } from '../pulse-upload/videoFile';

/** User-facing copy, kept together for translation. */
const ATTACHMENT_TEXT = {
  media: 'Media',
  chooseMedia: 'Choose photos, videos or documents to attach',
};

/** Every kind of file the composer can attach. */
const MEDIA_ACCEPT = ['image/*', VIDEO_FILE_ACCEPT, '.pdf,.doc,.docx,.txt'].join(',');

const MEDIA_ICON =
  'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z';

interface AttachmentBarProps {
  /** Called with each picked file, to stage and upload. */
  onFiles: (files: File[]) => void;
}

export function AttachmentBar({ onFiles }: AttachmentBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        className="hidden"
        aria-label={ATTACHMENT_TEXT.chooseMedia}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <ComposerChipButton
        onClick={() => inputRef.current?.click()}
        leftIcon={
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={MEDIA_ICON} />
          </svg>
        }
      >
        {ATTACHMENT_TEXT.media}
      </ComposerChipButton>
    </>
  );
}
