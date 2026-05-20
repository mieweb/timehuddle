import React, { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Modal, ModalHeader, ModalBody, ModalFooter, Button, Spinner } from '@mieweb/ui';

interface ProfileAvatarCropModalProps {
  open: boolean;
  image: string | null;
  onClose: () => void;
  onCropComplete: (croppedBlob: Blob) => void;
}

export const ProfileAvatarCropModal: React.FC<ProfileAvatarCropModalProps> = ({
  open,
  image,
  onClose,
  onCropComplete,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const onCropCompleteCb = useCallback(
    (
      _: { x: number; y: number; width: number; height: number },
      croppedAreaPixels: { x: number; y: number; width: number; height: number },
    ) => {
      setCroppedAreaPixels(croppedAreaPixels);
    },
    [],
  );

  const [cropError, setCropError] = useState<string | null>(null);

  const getCroppedImg = async () => {
    if (!image || !croppedAreaPixels) return;
    setLoading(true);
    setCropError(null);
    try {
      const imageEl = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.addEventListener('load', () => resolve(img));
        img.addEventListener('error', () => reject(new Error('Failed to load image')));
        img.setAttribute('crossOrigin', 'anonymous');
        img.src = image;
      });
      const canvas = document.createElement('canvas');
      const size = Math.max(croppedAreaPixels.width, croppedAreaPixels.height);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(
        imageEl,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        size,
        size,
      );
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to encode cropped image'));
        }, 'image/png');
      });
      onCropComplete(blob);
    } catch (err) {
      setCropError(err instanceof Error ? err.message : 'Crop failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      aria-label="Crop avatar image"
    >
      <ModalHeader>Crop Avatar</ModalHeader>
      <ModalBody>
        {image ? (
          <div className="relative w-full h-72 bg-neutral-900 rounded-lg overflow-hidden">
            <Cropper
              image={image}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropCompleteCb}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-72">No image selected</div>
        )}
      </ModalBody>
      <ModalFooter>
        {cropError && <p className="text-sm text-red-500 mr-auto">{cropError}</p>}
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={getCroppedImg} disabled={loading || !image}>
          {loading ? <Spinner size="sm" label="Cropping…" /> : 'Crop & Save'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
