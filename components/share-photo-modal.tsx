'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SharePhotoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted?: () => void;
}

export function SharePhotoModal({
  open,
  onOpenChange,
  onPosted,
}: SharePhotoModalProps) {
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedImageFile) {
      setImagePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedImageFile);
    setImagePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedImageFile]);

  const clearSelectedImageFile = () => {
    setSelectedImageFile(null);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setError('');
    setCaption('');
    clearSelectedImageFile();
  };

  const uploadImageFile = async (file: File): Promise<string | null> => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.secureUrl) {
        setError(payload?.error || 'Failed to upload image');
        return null;
      }

      return payload.secureUrl as string;
    } catch (uploadError) {
      console.error('Image upload error:', uploadError);
      setError('Failed to upload image');
      return null;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleCreatePost = async () => {
    setIsPosting(true);
    setError('');

    try {
      if (!selectedImageFile) {
        setError('Add at least one image to share a photo.');
        return;
      }

      const imageUrl = await uploadImageFile(selectedImageFile);
      if (!imageUrl) {
        return;
      }

      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim(),
          image_url: imageUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || 'Failed to post photo');
        return;
      }

      resetForm();
      onOpenChange(false);
      onPosted?.();
    } catch (uploadError) {
      console.error('Upload error:', uploadError);
      setError('Failed to post photo');
    } finally {
      setIsPosting(false);
    }
  };

  const handleSelectImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setSelectedImageFile(file);
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Share a Photo</DialogTitle>
          <DialogDescription>
            Upload a moment and add a caption for your shared timeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">Photo</label>

            <div className="border border-border rounded-lg p-4 bg-secondary">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleSelectImageFile}
                disabled={isUploadingImage}
                className="block w-full text-sm text-text-secondary file:mr-3 file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {imagePreviewUrl && (
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-background">
                  <NextImage
                    src={imagePreviewUrl}
                    alt="Selected preview"
                    width={400}
                    height={192}
                    className="h-48 w-full object-cover"
                  />
                </div>
              )}
            </div>
            <p className="text-xs text-text-secondary">
              {selectedImageFile
                ? 'Your image will upload when you press Post Photo.'
                : 'No image selected yet'}
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-foreground">Caption</label>
            <textarea
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="Share your thoughts..."
              rows={3}
              className="w-full resize-none border border-border rounded-lg px-4 py-3 bg-secondary focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-text-tertiary"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-error/10 px-4 py-3 text-sm text-error font-medium">
              {error}
            </div>
          )}

          <Button
            onClick={handleCreatePost}
            disabled={!selectedImageFile || isPosting || isUploadingImage}
            size="lg"
            className="w-full gap-2"
          >
            {isPosting ? (
              <>
                <img src="/animated_heart_icon.svg" alt="Loading" className="w-4 h-4" />
                Publishing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Post Photo
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
