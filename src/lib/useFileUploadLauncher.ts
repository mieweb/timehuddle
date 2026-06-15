import React, { useRef } from 'react';

export const MEDIA_UPLOAD_ACCEPT = 'image/*,image/gif,.gif,video/mp4,.mp4';

interface UseFileUploadLauncherOptions {
  accept: string;
  onFile: (file: File) => void | Promise<void>;
}

export function useFileUploadLauncher({ accept, onFile }: UseFileUploadLauncherOptions) {
  const inputRef = useRef<HTMLInputElement>(null);

  const openFileDialog = () => {
    inputRef.current?.click();
  };

  const inputProps = {
    ref: inputRef,
    type: 'file' as const,
    accept,
    className: 'hidden',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) void onFile(file);
    },
  };

  return { inputProps, openFileDialog };
}
