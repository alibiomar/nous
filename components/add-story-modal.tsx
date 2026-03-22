'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageIcon, Music, Upload, Video, X, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddStoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted?: () => void;
}

const MAX_VIDEO_DURATION = 30;
const COMPRESS_MAX_WIDTH = 1080;
const COMPRESS_QUALITY = 0.82;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com';
  } catch { return false; }
}

function extractYouTubeTitle(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('v') || u.pathname.split('/').pop();
    return id ? `YouTube · ${id}` : 'YouTube';
  } catch { return 'YouTube'; }
}

// Client-side image compression via canvas
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
          // Only use compressed if it's actually smaller
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

// ── Drop zone component ────────────────────────────────────────────────────────

function DropZone({
  accept,
  icon: Icon,
  label,
  hint,
  preview,
  previewType,
  onFile,
  onClear,
  videoRef,
}: {
  accept: string;
  icon: React.ElementType;
  label: string;
  hint: string;
  preview: string | null;
  previewType?: 'image' | 'video';
  onFile: (file: File) => void;
  onClear: () => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
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
        dragging ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border/50 hover:border-primary/50 hover:bg-primary/5',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />

      {preview ? (
        <div className="relative aspect-9/16 max-h-64 w-full">
          {previewType === 'video' ? (
            <video
              ref={videoRef as React.RefObject<HTMLVideoElement>}
              src={preview}
              className="h-full w-full object-cover"
              playsInline
              muted
            />
          ) : (
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/40 to-transparent" />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
          <div className="rounded-2xl bg-primary/10 p-3">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function AddStoryModal({ open, onOpenChange, onPosted }: AddStoryModalProps) {
  const [error, setError] = useState('');
  const [caption, setCaption] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [startOffset, setStartOffset] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [uploadStep, setUploadStep] = useState('');

  // Sync scrubber → video preview
  useEffect(() => {
    if (videoRef.current) videoRef.current.currentTime = startOffset;
  }, [startOffset]);

  const resetForm = () => {
    setError(''); setCaption(''); setYoutubeUrl('');
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setImageFile(null); setImagePreview(null);
    setVideoFile(null); setVideoPreview(null);
    setVideoDuration(0); setStartOffset(0);
    setUploadStep('');
  };

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { setError('Please select an image file.'); return; }
    setError('');
    // Show preview immediately from original
    setImagePreview(URL.createObjectURL(file));
    // Compress in background
    const compressed = await compressImage(file);
    setImageFile(compressed);
  }, []);

  const handleVideoFile = useCallback((file: File) => {
    if (!file.type.startsWith('video/')) { setError('Please select a video file.'); return; }
    setError('');
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.src = url;
    vid.onloadedmetadata = () => {
      setVideoDuration(vid.duration);
      setStartOffset(0);
      setVideoFile(file);
      setVideoPreview(url);
    };
  }, []);

  const uploadFile = async (file: File, startOff = 0): Promise<{ url: string; publicId: string } | null> => {
    const fd = new FormData();
    fd.append('file', file);
    if (file.type.startsWith('video/')) fd.append('startOffset', startOff.toString());

    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || !data.secureUrl) {
      setError(data?.error || 'Upload failed');
      return null;
    }
    return { url: data.secureUrl, publicId: data.publicId };
  };

  const handlePost = async () => {
    if (!imageFile) { setError('A cover photo is required.'); return; }
    if (youtubeUrl && !isYouTubeUrl(youtubeUrl)) { setError('Please enter a valid YouTube URL.'); return; }

    setError(''); setIsPosting(true);
    try {
      setUploadStep('Uploading photo…');
      setIsUploading(true);
      const imageResult = await uploadFile(imageFile);
      if (!imageResult) return;

      let videoUrl: string | null = null;
      let videoPublicId: string | null = null;
      if (videoFile) {
        setUploadStep('Uploading video…');
        const videoResult = await uploadFile(videoFile, startOffset);
        if (!videoResult) return;
        videoUrl = videoResult.url;
        videoPublicId = videoResult.publicId;
      }
      setIsUploading(false);
      setUploadStep('Posting…');

      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageResult.url,
          image_public_id: imageResult.publicId,
          video_url: videoUrl,
          video_public_id: videoPublicId,
          media_type: videoUrl ? 'video' : 'image',
          caption: caption.trim() || null,
          youtube_url: youtubeUrl.trim() || null,
          youtube_title: youtubeUrl.trim() ? extractYouTubeTitle(youtubeUrl.trim()) : null,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.error || 'Failed to post story');
        return;
      }

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

  const maxStart = Math.max(0, videoDuration - MAX_VIDEO_DURATION);
  const endOffset = Math.min(startOffset + MAX_VIDEO_DURATION, videoDuration);
  const busy = isPosting || isUploading;

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) resetForm(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-md rounded-3xl border-border/60">

        {/* Header */}
        <div className="sticky top-0 z-10 rounded-t-3xl border-b border-border/50 bg-background/95 px-6 py-4 backdrop-blur-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">New Story</DialogTitle>

          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-5">

          {/* ── Cover photo ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Cover photo <span className="text-primary">*</span>
            </label>
            <DropZone
              accept="image/*"
              icon={ImageIcon}
              label="Drop a photo or tap to choose"
              hint="JPEG, PNG, WEBP · auto-compressed"
              preview={imagePreview}
              previewType="image"
              onFile={handleImageFile}
              onClear={() => { if (imagePreview) URL.revokeObjectURL(imagePreview); setImageFile(null); setImagePreview(null); }}
            />
          </div>

          {/* ── Video clip ── */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Film className="h-3.5 w-3.5" />
              Video clip <span className="font-normal normal-case tracking-normal text-muted-foreground/70">optional · max 30s</span>
            </label>
            <DropZone
              accept="video/*"
              icon={Video}
              label="Drop a video or tap to choose"
              hint="MP4, MOV · up to 50MB"
              preview={videoPreview}
              previewType="video"
              videoRef={videoRef}
              onFile={handleVideoFile}
              onClear={() => { if (videoPreview) URL.revokeObjectURL(videoPreview); setVideoFile(null); setVideoPreview(null); setVideoDuration(0); setStartOffset(0); }}
            />

            {/* Trim scrubber */}
            {videoPreview && videoDuration > MAX_VIDEO_DURATION && (
              <div className="rounded-2xl border border-border/50 bg-secondary/40 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-medium">Clip start</span>
                  <span className="tabular-nums">{startOffset.toFixed(1)}s → {endOffset.toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxStart}
                  step={0.1}
                  value={startOffset}
                  onChange={(e) => setStartOffset(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1.5 cursor-pointer"
                />
                <p className="text-[10px] text-muted-foreground text-center">
                  Drag to choose your 30-second clip
                </p>
              </div>
            )}
            {videoPreview && videoDuration <= MAX_VIDEO_DURATION && (
              <p className="text-xs text-primary text-center">
                Full video · {videoDuration.toFixed(1)}s
              </p>
            )}
          </div>

          {/* ── Caption ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caption</label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Say something..."
              rows={2}
              className="w-full resize-none rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            />
          </div>

          {/* ── Song ── */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Music className="h-3.5 w-3.5" />
              Song
            </label>
            <Input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="Paste a YouTube URL..."
              className="rounded-2xl border-border/60 bg-secondary/40 text-sm"
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
                Share Story
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}