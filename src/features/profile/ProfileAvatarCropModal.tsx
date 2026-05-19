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

  const getCroppedImg = async () => {
    if (!image || !croppedAreaPixels) return;
    setLoading(true);
    const createImage = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new window.Image();
        img.addEventListener('load', () => resolve(img));
        img.addEventListener('error', (err) => reject(err));
        img.setAttribute('crossOrigin', 'anonymous');
        img.src = url;
      });
    const imageEl = await createImage(image);
    const canvas = document.createElement('canvas');
    const size = Math.max(croppedAreaPixels.width, croppedAreaPixels.height);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
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
    canvas.toBlob((blob) => {
      setLoading(false);
      if (blob) onCropComplete(blob);
    }, 'image/png');
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
