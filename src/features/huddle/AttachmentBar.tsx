import { useRef, useState } from 'react';
import { uploadMedia } from './api';
import type { MediaItem } from './types';

interface AttachmentBarProps {
  onAttachmentAdd: (media: MediaItem) => void;
}

export function AttachmentBar({ onAttachmentAdd }: AttachmentBarProps) {
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File, fileType: 'photo' | 'video' | 'doc') => {
    console.log('[AttachmentBar] File selected:', file.name, 'type:', fileType);
    
    // Only photos are supported in Phase 1 (backend limitation)
    if (fileType !== 'photo') {
      alert(`${fileType === 'video' ? 'Video' : 'Document'} uploads are not yet supported. Please use photos for now.`);
      return;
    }
    
    setUploading(true);
    try {
      console.log('[AttachmentBar] Uploading file...');
      const media = await uploadMedia(file);
      console.log('[AttachmentBar] Upload successful, media:', media);
      onAttachmentAdd(media);
    } catch (error) {
      console.error('[AttachmentBar] Upload failed:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoClick = () => {
    photoInputRef.current?.click();
  };

  const handleVideoClick = () => {
    videoInputRef.current?.click();
  };

  const handleDocClick = () => {
    docInputRef.current?.click();
  };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
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
        onChange={e => {
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
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file, 'doc');
          e.target.value = '';
        }}
      />

      {/* Photo button */}
      <button
        onClick={handlePhotoClick}
        disabled={uploading}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {uploading ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Uploading...
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Photo
          </>
        )}
      </button>

      {/* Video button */}
      <button
        onClick={handleVideoClick}
        disabled={uploading}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Video
      </button>

      {/* Doc button */}
      <button
        onClick={handleDocClick}
        disabled={uploading}
        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-neutral-400 border border-gray-200 dark:border-neutral-700 px-3 py-1.5 rounded-full hover:bg-gray-50 dark:hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Doc
      </button>
    </>
  );
}
