'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageIcon, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePushNotifications } from '@/hooks/use-push-notifications';

interface SharePhotoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted?: () => void;
}

const COMPRESS_MAX_WIDTH = 1200;
const COMPRESS_QUALITY = 0.85;

// ── Image compression ─────────────────────────────────────────────────────────
async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      const scale = Math.min(1, COMPRESS_MAX_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name, { type: 'image/jpeg' });
          resolve(compressed.size < file.size ? compressed : file);
        },
        'image/jpeg',
        COMPRESS_QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

// ── Drop zone ─────────────────────────────────────────────────────────────────
function DropZone({
  preview,
  onFile,
  onClear,
}: {
  preview: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div
      onClick={() => !preview && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        'relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200',
        preview ? 'border-transparent cursor-default' : 'cursor-pointer',
        dragging
          ? 'border-primary bg-primary/10 scale-[1.01]'
          : 'border-border/50 hover:border-primary/50 hover:bg-primary/5',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      {preview ? (
        <div className="relative w-full">
          <img
            src={preview}
            alt="Preview"
            className="w-full max-h-80 object-cover rounded-2xl"
          />
          <div className="absolute inset-0 bg-linear-to-t from-black/30 to-transparent rounded-2xl pointer-events-none" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute right-2.5 top-2.5 rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2.5 py-10 px-4 text-center">
          <div className="rounded-2xl bg-primary/10 p-3.5">
            <ImageIcon className="h-7 w-7 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Drop a photo or tap to choose</p>
            <p className="mt-0.5 text-xs text-muted-foreground">JPEG, PNG, WEBP · auto-compressed</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function SharePhotoModal({ open, onOpenChange, onPosted }: SharePhotoModalProps) {
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const { sendPushNotification } = usePushNotifications();

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => { if (imagePreview) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  const resetForm = () => {
    setError(''); setCaption('');
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null); setImagePreview(null);
    setUploadStep('');
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return; }
    setError('');
    setImagePreview(URL.createObjectURL(file)); // show immediately
    const compressed = await compressImage(file);
    setImageFile(compressed);
  }, []);

  const handlePost = async () => {
    if (!imageFile) { setError('Please select a photo.'); return; }
    setError(''); setIsPosting(true);
    try {
      setUploadStep('Uploading photo…');
      setIsUploading(true);
      const fd = new FormData();
      fd.append('file', imageFile);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
      const uploadData = await uploadRes.json().catch(() => null);
      setIsUploading(false);

      if (!uploadRes.ok || !uploadData?.secureUrl) {
        setError(uploadData?.error || 'Failed to upload photo');
        return;
      }

      setUploadStep('Posting…');
      const postRes = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: caption.trim(), image_url: uploadData.secureUrl }),
      });

      if (!postRes.ok) {
        const d = await postRes.json().catch(() => null);
        setError(d?.error || 'Failed to post photo');
        return;
      }

      const notifBody = caption.trim()
        ? `posted a new photo — ${caption.trim()}`
        : 'posted a new moment 📸';
      await sendPushNotification(notifBody, { url: '/feed' });

      resetForm();
      onOpenChange(false);
      onPosted?.();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsPosting(false);
      setIsUploading(false);
      setUploadStep('');
    }
  };

  const busy = isPosting || isUploading;

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) resetForm(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-md rounded-3xl border-border/60">

        {/* Sticky header */}
        <div className="sticky top-0 z-10 rounded-t-3xl border-b border-border/50 bg-background/95 px-6 py-4 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Share a Moment</DialogTitle>
            <DialogDescription className="text-xs">
              Add a photo and caption to your shared timeline.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-5">

          {/* ── Photo drop zone ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Photo <span className="text-primary">*</span>
            </label>
            <DropZone
              preview={imagePreview}
              onFile={handleFile}
              onClear={() => {
                if (imagePreview) URL.revokeObjectURL(imagePreview);
                setImageFile(null);
                setImagePreview(null);
              }}
            />
          </div>

          {/* ── Caption ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Caption
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Share your thoughts..."
              rows={3}
              className="w-full resize-none rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-[16px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
          </div>

          {error && (
            <div className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              {error}
            </div>
          )}

          <Button
            onClick={handlePost}
            disabled={!imageFile || busy}
            size="lg"
            className="w-full gap-2 rounded-2xl h-12"
          >
            {busy ? (
              <>
                <img src="/animated_heart_icon.svg" alt="" className="h-4 w-4" />
                {uploadStep || 'Working…'}
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Post Photo
              </>
            )}
          </Button>

        </div>
      </DialogContent>
    </Dialog>
  );
}