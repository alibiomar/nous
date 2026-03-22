'use client';

import {
  useCallback, useEffect, useRef, useState, type PointerEvent,
} from 'react';
import {
  Camera, CameraOff, Check, ChevronRight, Minus, Music,
  Pen, Plus, RotateCcw, SwitchCamera, Type, Upload, X,
  Sparkles, AlignCenter, Trash2,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

type Tool   = 'none' | 'draw' | 'text';
type Panel  = 'none' | 'music' | 'share';

const COMPRESS_MAX_WIDTH = 1080;
const COMPRESS_QUALITY   = 0.82;
const MAX_VIDEO_DURATION = 30;

const COLORS = [
  '#ffffff', '#000000', '#FF385C', '#FF6B35',
  '#FFD60A', '#30D158', '#64D2FF', '#0A84FF',
  '#BF5AF2', '#FF375F',
];
const BRUSH_SIZES = [3, 6, 12, 20];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isYouTubeUrl(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com';
  } catch { return false; }
}

function extractYouTubeTitle(url: string) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('v') || u.pathname.split('/').pop();
    return id ? `YouTube · ${id}` : 'YouTube';
  } catch { return 'YouTube'; }
}

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const burl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(burl);
      const scale = Math.min(1, COMPRESS_MAX_WIDTH / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) { resolve(file); return; }
        const c = new File([blob], file.name, { type: 'image/jpeg' });
        resolve(c.size < file.size ? c : file);
      }, 'image/jpeg', COMPRESS_QUALITY);
    };
    img.onerror = () => { URL.revokeObjectURL(burl); resolve(file); };
    img.src = burl;
  });
}

async function flattenToBlob(
  mediaEl: HTMLImageElement | HTMLVideoElement,
  overlayCanvas: HTMLCanvasElement,
  textItems: TextItem[],
): Promise<Blob> {
  const w = overlayCanvas.width, h = overlayCanvas.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(mediaEl, 0, 0, w, h);
  ctx.drawImage(overlayCanvas, 0, 0);
  for (const item of textItems) {
    ctx.save();
    ctx.font = `bold ${item.size}px sans-serif`;
    ctx.fillStyle = item.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.strokeText(item.text, item.x * w, item.y * h);
    ctx.fillText(item.text, item.x * w, item.y * h);
    ctx.restore();
  }
  return new Promise((res, rej) =>
    out.toBlob((b) => b ? res(b) : rej(new Error('empty')), 'image/jpeg', COMPRESS_QUALITY)
  );
}

interface TextItem {
  id: string; text: string; color: string; size: number; x: number; y: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface StoryCreatorProps {
  open: boolean;
  onClose: () => void;
  onPosted?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function StoryCreator({ open, onClose, onPosted }: StoryCreatorProps) {
  // Media
  const [mediaFile, setMediaFile]         = useState<File | null>(null);
  const [mediaPreview, setMediaPreview]   = useState<string | null>(null);
  const [mediaKind, setMediaKind]         = useState<'image' | 'video'>('image');
  const [videoDuration, setVideoDuration] = useState(0);
  const [startOffset, setStartOffset]     = useState(0);

  // Camera
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording]   = useState(false);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecRef    = useRef<MediaRecorder | null>(null);
  const recordChunks   = useRef<Blob[]>([]);

  // Tools
  const [tool, setTool]             = useState<Tool>('none');
  const [color, setColor]           = useState('#ffffff');
  const [brushSize, setBrushSize]   = useState(6);
  const [textItems, setTextItems]   = useState<TextItem[]>([]);
  const [activeText, setActiveText] = useState('');
  const [textSize, setTextSize]     = useState(32);
  const [isDragging, setIsDragging] = useState<string | null>(null);

  // Canvas
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const editImgRef = useRef<HTMLImageElement | null>(null);
  const editVidRef = useRef<HTMLVideoElement | null>(null);
  const isDrawing  = useRef(false);
  const lastPt     = useRef({ x: 0, y: 0 });
  const stageRef   = useRef<HTMLDivElement | null>(null);
  const undoStack  = useRef<ImageData[]>([]);

  // Panels & share
  const [panel, setPanel]               = useState<Panel>('none');
  const [youtubeUrl, setYoutubeUrl]     = useState('');
  const [youtubeTitle, setYoutubeTitle] = useState('');
  const [youtubeError, setYoutubeError] = useState('');
  const [caption, setCaption]           = useState('');
  const [isPosting, setIsPosting]       = useState(false);
  const [uploadStep, setUploadStep]     = useState('');
  const [postError, setPostError]       = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) setTimeout(() => setVisible(true), 10);
    else setVisible(false);
  }, [open]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null); setCameraActive(false);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null); setMediaPreview(null); setMediaKind('image');
    setVideoDuration(0); setStartOffset(0);
    setTool('none'); setTextItems([]); setActiveText('');
    setPanel('none');
    setYoutubeUrl(''); setYoutubeTitle(''); setYoutubeError('');
    setCaption(''); setIsPosting(false); setUploadStep(''); setPostError('');
    undoStack.current = [];
  }, [mediaPreview, cameraStream]);

  useEffect(() => { if (!open) reset(); }, [open, reset]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cameraStream?.getTracks().forEach(t => t.stop());
    setCameraStream(null); setCameraActive(false);
  }, [cameraStream]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: cameraFacing }, width: { ideal: 1080 }, height: { ideal: 1920 } },
        audio: true,
      });
      setCameraStream(stream); setCameraActive(true);
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
    } catch {}
  }, [cameraFacing]);

  const flipCamera = useCallback(() => {
    stopCamera();
    setCameraFacing(f => f === 'user' ? 'environment' : 'user');
  }, [stopCamera]);

  useEffect(() => { if (cameraActive) startCamera(); }, [cameraFacing]);

  const capturePhoto = useCallback(() => {
    const vid = cameraVideoRef.current; if (!vid) return;
    const c = document.createElement('canvas');
    c.width = vid.videoWidth; c.height = vid.videoHeight;
    c.getContext('2d')!.drawImage(vid, 0, 0);
    c.toBlob(blob => {
      if (!blob) return;
      stopCamera();
      loadMedia(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }, [stopCamera]);

  const startRecording = useCallback(() => {
    if (!cameraStream) return;
    recordChunks.current = [];
    const rec = new MediaRecorder(cameraStream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => { if (e.data.size > 0) recordChunks.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(recordChunks.current, { type: 'video/webm' });
      stopCamera();
      loadMedia(new File([blob], 'capture.webm', { type: 'video/webm' }));
    };
    rec.start(); mediaRecRef.current = rec; setIsRecording(true);
    setTimeout(() => stopRecording(), MAX_VIDEO_DURATION * 1000);
  }, [cameraStream, stopCamera]);

  const stopRecording = useCallback(() => {
    mediaRecRef.current?.stop(); mediaRecRef.current = null; setIsRecording(false);
  }, []);

  // ── Load media ─────────────────────────────────────────────────────────────
  const loadMedia = useCallback((file: File) => {
    if (file.type.startsWith('image/')) {
      setMediaKind('image');
      setMediaPreview(URL.createObjectURL(file));
      setMediaFile(file);
    } else if (file.type.startsWith('video/')) {
      setMediaKind('video');
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video');
      vid.src = url;
      vid.onloadedmetadata = () => {
        setVideoDuration(vid.duration); setStartOffset(0);
        setMediaPreview(url); setMediaFile(file);
      };
    }
  }, []);

  // ── Canvas ─────────────────────────────────────────────────────────────────
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current, zone = stageRef.current;
    if (!canvas || !zone) return;
    canvas.width = zone.clientWidth; canvas.height = zone.clientHeight;
  }, []);

  useEffect(() => { if (mediaPreview) setTimeout(initCanvas, 50); }, [mediaPreview, initCanvas]);

  const getCanvasPt = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const pushUndo = () => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    undoStack.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (undoStack.current.length > 20) undoStack.current.shift();
  };

  const undo = () => {
    const c = canvasRef.current;
    if (!c || !undoStack.current.length) return;
    c.getContext('2d')!.putImageData(undoStack.current.pop()!, 0, 0);
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'draw') return;
    pushUndo(); isDrawing.current = true; lastPt.current = getCanvasPt(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || tool !== 'draw') return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d')!, pt = getCanvasPt(e);
    ctx.beginPath(); ctx.moveTo(lastPt.current.x, lastPt.current.y); ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = color; ctx.lineWidth = brushSize; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    lastPt.current = pt;
  };
  const onPointerUp = () => { isDrawing.current = false; };

  // ── Text ───────────────────────────────────────────────────────────────────
  const addText = () => {
    if (!activeText.trim()) return;
    setTextItems(p => [...p, { id: crypto.randomUUID(), text: activeText.trim(), color, size: textSize, x: 0.5, y: 0.45 }]);
    setActiveText(''); setTool('none');
  };

  const dragText = (id: string, e: PointerEvent<HTMLSpanElement>) => {
    const zone = stageRef.current; if (!zone) return;
    setIsDragging(id);
    const rect = zone.getBoundingClientRect();
    const onMove = (ev: globalThis.PointerEvent) => {
      setTextItems(prev => prev.map(t => t.id !== id ? t : {
        ...t,
        x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (ev.clientY - rect.top)  / rect.height)),
      }));
    };
    const onUp = () => {
      setIsDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ── Music confirm ──────────────────────────────────────────────────────────
  const confirmMusic = () => {
    const url = youtubeUrl.trim();
    if (!url) { setYoutubeTitle(''); setPanel('none'); return; }
    if (!isYouTubeUrl(url)) { setYoutubeError('Invalid YouTube URL'); return; }
    setYoutubeError(''); setYoutubeTitle(extractYouTubeTitle(url)); setPanel('none');
  };

  // ── Upload / Post ──────────────────────────────────────────────────────────
  const uploadFile = async (file: File, startOff = 0) => {
    const fd = new FormData();
    fd.append('file', file);
    if (file.type.startsWith('video/')) fd.append('startOffset', startOff.toString());
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok || !data.secureUrl) { setPostError(data?.error || 'Upload failed'); return null; }
    return { url: data.secureUrl as string, publicId: data.publicId as string };
  };

  const handlePost = async () => {
    if (!mediaFile) return;
    setPostError(''); setIsPosting(true);
    try {
      let imageFile: File; let videoFile: File | null = null;
      if (mediaKind === 'image') {
        setUploadStep('Rendering edits…');
        const blob = await flattenToBlob(editImgRef.current!, canvasRef.current!, textItems);
        imageFile = await compressImage(new File([blob], 'story.jpg', { type: 'image/jpeg' }));
      } else {
        setUploadStep('Creating thumbnail…');
        const vid = editVidRef.current!;
        const t = document.createElement('canvas');
        t.width = vid.videoWidth || 480; t.height = vid.videoHeight || 854;
        t.getContext('2d')!.drawImage(vid, 0, 0, t.width, t.height);
        const tb = await new Promise<Blob>(r => t.toBlob(b => r(b!), 'image/jpeg', 0.85));
        imageFile = new File([tb], 'thumb.jpg', { type: 'image/jpeg' });
        videoFile = mediaFile;
      }
      setUploadStep('Uploading…');
      const imgR = await uploadFile(imageFile); if (!imgR) return;
      let videoUrl: string | null = null, videoPublicId: string | null = null;
      if (videoFile) {
        const vidR = await uploadFile(videoFile, startOffset); if (!vidR) return;
        videoUrl = vidR.url; videoPublicId = vidR.publicId;
      }
      setUploadStep('Posting…');
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imgR.url, image_public_id: imgR.publicId,
          video_url: videoUrl, video_public_id: videoPublicId,
          media_type: videoUrl ? 'video' : 'image',
          caption: caption.trim() || null,
          youtube_url: youtubeUrl.trim() || null,
          youtube_title: youtubeTitle || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); setPostError(d?.error || 'Failed'); return; }
      reset(); onPosted?.(); onClose();
    } catch { setPostError('Something went wrong.'); }
    finally { setIsPosting(false); setUploadStep(''); }
  };

  if (!open) return null;

  const hasMedia = !!mediaPreview;
  const maxStart = Math.max(0, videoDuration - MAX_VIDEO_DURATION);
  const endOffset = Math.min(startOffset + MAX_VIDEO_DURATION, videoDuration);
  const hasDrawings = undoStack.current.length > 0 || textItems.length > 0;

  // ─────────────────────────────────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────────────────────────────────
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
    .sc * { font-family: 'DM Sans', -apple-system, sans-serif; box-sizing: border-box; }
    .sc {
      position: fixed; inset: 0; z-index: 200; background: #000; overflow: hidden;
      transform: translateY(${visible ? '0' : '100%'});
      opacity: ${visible ? 1 : 0};
      transition: transform 0.42s cubic-bezier(0.32,0.72,0,1), opacity 0.24s ease;
    }
    .gbtn {
      width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
      background: rgba(0,0,0,0.4); backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid rgba(255,255,255,0.15);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: white;
      transition: background 0.15s, transform 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .gbtn:active { transform: scale(0.88); }
    .gbtn.on { background: rgba(255,255,255,0.93); color: #000; }
    .gbtn.sm { width: 36px; height: 36px; }
    .cdot {
      border-radius: 50%; cursor: pointer; flex-shrink: 0;
      transition: transform 0.14s, box-shadow 0.14s;
    }
    .cdot.sel { transform: scale(1.3); box-shadow: 0 0 0 2.5px rgba(255,255,255,0.9); }
    .cdot:not(.sel) { box-shadow: 0 0 0 1.5px rgba(255,255,255,0.18); }
    .pill {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(255,255,255,0.93); color: #000;
      font-size: 14px; font-weight: 700; letter-spacing: -0.2px;
      padding: 9px 18px; border-radius: 100px; cursor: pointer;
      border: none; -webkit-tap-highlight-color: transparent;
      transition: transform 0.12s;
    }
    .pill:active { transform: scale(0.94); }
    .panel {
      position: absolute; left: 0; right: 0; bottom: 0;
      border-radius: 24px 24px 0 0;
      background: rgba(12,12,12,0.94);
      backdrop-filter: blur(36px) saturate(200%);
      border-top: 1px solid rgba(255,255,255,0.08);
      z-index: 50; padding: 0 20px 44px;
      transition: transform 0.38s cubic-bezier(0.32,0.72,0,1);
    }
    .panel.open  { transform: translateY(0); }
    .panel.shut  { transform: translateY(110%); }
    .handle { width: 38px; height: 4px; border-radius: 99px; background: rgba(255,255,255,0.18); margin: 14px auto 22px; cursor: pointer; }
    .field {
      width: 100%; background: rgba(255,255,255,0.07);
      border: 1.5px solid rgba(255,255,255,0.11);
      border-radius: 14px; padding: 13px 16px;
      font-size: 14px; color: white; outline: none;
      font-family: 'DM Sans', sans-serif; resize: none;
      transition: border-color 0.2s;
    }
    .field::placeholder { color: rgba(255,255,255,0.28); }
    .field:focus { border-color: rgba(255,255,255,0.32); }
    .share-btn {
      width: 100%; height: 52px; border-radius: 16px; border: none;
      background: linear-gradient(135deg, #FF385C 0%, #FF6B35 100%);
      color: white; font-size: 16px; font-weight: 700; letter-spacing: -0.3px;
      display: flex; align-items: center; justify-content: center; gap: 9px;
      cursor: pointer; box-shadow: 0 6px 28px rgba(255,56,92,0.45);
      transition: opacity 0.15s, transform 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .share-btn:active { transform: scale(0.98); }
    .share-btn:disabled { opacity: 0.65; }
    .conf-btn {
      width: 100%; border: 1px solid rgba(255,255,255,0.12); border-radius: 13px;
      background: rgba(255,255,255,0.08); padding: 13px;
      font-size: 14px; font-weight: 600; color: white;
      cursor: pointer; transition: background 0.15s, transform 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .conf-btn:active { background: rgba(255,255,255,0.13); transform: scale(0.98); }
    .scrub {
      -webkit-appearance: none; appearance: none;
      width: 100%; height: 3px; border-radius: 99px;
      background: rgba(255,255,255,0.2); outline: none; cursor: pointer;
    }
    .scrub::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px; height: 18px; border-radius: 50%; background: white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
    }
    .pick-row {
      display: flex; align-items: center; gap: 14px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.09);
      border-radius: 18px; padding: 17px 18px; cursor: pointer;
      width: 100%; transition: background 0.18s, transform 0.12s;
      -webkit-tap-highlight-color: transparent;
    }
    .pick-row:active { background: rgba(255,255,255,0.1); transform: scale(0.98); }
    .shutter {
      width: 72px; height: 72px; border-radius: 50%;
      border: 4px solid rgba(255,255,255,0.85);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.14s;
      background: rgba(255,255,255,0.14); backdrop-filter: blur(8px);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.1), 0 8px 32px rgba(0,0,0,0.4);
    }
    .shutter:active { transform: scale(0.91); }
    .shutter.rec { animation: rp 1.2s ease infinite; }
    @keyframes rp {
      0%,100% { box-shadow: 0 0 0 0 rgba(255,56,92,0.5), 0 8px 32px rgba(0,0,0,0.4); }
      50%      { box-shadow: 0 0 0 16px rgba(255,56,92,0), 0 8px 32px rgba(0,0,0,0.4); }
    }
    .rec-pill {
      display: inline-flex; align-items: center; gap: 5px;
      background: rgba(255,56,92,0.85); backdrop-filter: blur(8px);
      padding: 5px 11px; border-radius: 100px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: white;
    }
    .rec-dot { width: 6px; height: 6px; border-radius: 50%; background: white; animation: rd 1s ease infinite; }
    @keyframes rd { 0%,100%{opacity:1} 50%{opacity:0.2} }
    .bdot {
      border-radius: 50%; border: 2px solid rgba(255,255,255,0.25);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0; transition: border-color 0.14s;
    }
    .bdot.on { border-color: rgba(255,255,255,0.9); }
    .err { background: rgba(255,56,92,0.13); border: 1px solid rgba(255,56,92,0.25); border-radius: 12px; padding: 10px 14px; font-size: 12px; color: #FF8FA3; }
    .spinner { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; border: 2.5px solid rgba(255,255,255,0.25); border-top-color: white; animation: sp 0.65s linear infinite; }
    @keyframes sp { to { transform: rotate(360deg); } }
    .sz-btn { width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,0.1); border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.14s; }
    .sz-btn:active { background: rgba(255,255,255,0.2); }
  `;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="sc">

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* PICK SCREEN                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {!hasMedia && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'radial-gradient(ellipse 80% 60% at 50% 36%, #191919 0%, #060606 100%)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '52px 16px 0' }}>
              <button type="button" onClick={onClose} className="gbtn"><X size={18} /></button>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'white', letterSpacing: '-0.4px' }}>New Story</span>
              <div style={{ width: 42 }} />
            </div>

            {/* Camera area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', margin: '20px 0 0' }}>
              {cameraActive ? (
                <>
                  <video ref={cameraVideoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay playsInline muted />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 55%)' }} />
                  {isRecording && (
                    <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)' }}>
                      <div className="rec-pill"><div className="rec-dot" />REC</div>
                    </div>
                  )}
                  <button type="button" onClick={flipCamera} className="gbtn" style={{ position: 'absolute', top: 16, right: 16 }}><SwitchCamera size={18} /></button>
                </>
              ) : (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <div style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Camera size={36} color="rgba(255,255,255,0.2)" />
                  </div>
                  <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.22)' }}>Camera preview</span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{ padding: '20px 24px 48px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cameraActive ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
                  <button type="button" onClick={stopCamera} className="gbtn"><CameraOff size={18} /></button>
                  <div
                    className={`shutter${isRecording ? ' rec' : ''}`}
                    onPointerDown={() => { if (!isRecording) startRecording(); }}
                    onPointerUp={() => { if (isRecording) stopRecording(); }}
                    onClick={capturePhoto}
                  >
                    {isRecording
                      ? <div style={{ width: 22, height: 22, borderRadius: 6, background: '#FF385C' }} />
                      : <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(255,255,255,0.9)' }} />
                    }
                  </div>
                  <div style={{ width: 42 }} />
                </div>
              ) : (
                <>
                  <button type="button" onClick={startCamera} className="pick-row" style={{ justifyContent: 'center', gap: 10 }}>
                    <Camera size={18} color="rgba(255,255,255,0.75)" />
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Open Camera</span>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>or</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) loadMedia(f); }} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="pick-row">
                    <div style={{ width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(135deg,#FF385C,#FF6B35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Upload size={20} color="white" />
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>Choose from library</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', marginTop: 2 }}>Photo or video</div>
                    </div>
                    <ChevronRight size={16} color="rgba(255,255,255,0.25)" style={{ marginLeft: 'auto' }} />
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* MEDIA STAGE — everything overlaid on the media                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {hasMedia && (
          <div ref={stageRef} style={{ position: 'relative', width: '100%', height: '100%' }}>

            {/* Media */}
            {mediaKind === 'image'
              ? <img ref={editImgRef} src={mediaPreview!} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <video ref={editVidRef} src={mediaPreview!} autoPlay playsInline loop muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            }

            {/* Draw canvas */}
            <canvas ref={canvasRef}
              style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: tool === 'draw' ? 'crosshair' : 'default', pointerEvents: tool === 'draw' ? 'auto' : 'none' }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            />

            {/* Text labels */}
            {textItems.map(item => (
              <span key={item.id} onPointerDown={e => dragText(item.id, e)}
                style={{
                  position: 'absolute', zIndex: 15,
                  left: `${item.x * 100}%`, top: `${item.y * 100}%`,
                  transform: `translate(-50%,-50%) scale(${isDragging === item.id ? 1.07 : 1})`,
                  color: item.color, fontSize: item.size, fontWeight: 700,
                  textShadow: '0 2px 10px rgba(0,0,0,0.7)',
                  touchAction: 'none', cursor: 'grab', userSelect: 'none',
                  transition: 'transform 0.1s',
                }}>{item.text}</span>
            ))}

            {/* ── TOP BAR ──────────────────────────────────────────────── */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '48px 14px 16px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.52) 0%, transparent 100%)',
              pointerEvents: 'none',
            }}>
              {/* Left: close */}
              <button type="button" onClick={() => reset()} className="gbtn" style={{ pointerEvents: 'auto' }}><X size={18} /></button>

              {/* Center: music badge when set */}
              {youtubeTitle && tool === 'none' && panel === 'none' ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 100, padding: '6px 12px', maxWidth: 200, pointerEvents: 'auto' }} onClick={() => setPanel('music')}>
                  <Music size={12} color="#FF385C" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{youtubeTitle}</span>
                </div>
              ) : <div />}

              {/* Right: undo / close tool */}
              {tool === 'draw' ? (
                <button type="button" onClick={undo} className="gbtn" style={{ pointerEvents: 'auto' }}><RotateCcw size={16} /></button>
              ) : tool === 'text' ? (
                <button type="button" onClick={() => { setTool('none'); setActiveText(''); }} className="gbtn" style={{ pointerEvents: 'auto' }}><X size={16} /></button>
              ) : <div style={{ width: 42 }} />}
            </div>

            {/* ── RIGHT TOOLBAR (default mode) ─────────────────────────── */}
            {tool === 'none' && panel === 'none' && (
              <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 10, zIndex: 30 }}>
                <button type="button" onClick={() => setTool('draw')} className="gbtn" title="Draw"><Pen size={18} /></button>
                <button type="button" onClick={() => setTool('text')} className="gbtn" title="Text"><Type size={18} /></button>
                {hasDrawings && (
                  <button type="button" className="gbtn" title="Clear" onClick={() => {
                    const c = canvasRef.current;
                    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
                    setTextItems([]); undoStack.current = [];
                  }}><Trash2 size={16} /></button>
                )}
                <button type="button" onClick={() => setPanel('music')} className={`gbtn${youtubeTitle ? ' on' : ''}`} title="Music"><Music size={18} /></button>
              </div>
            )}

            {/* ── DRAW PALETTE ─────────────────────────────────────────── */}
            {tool === 'draw' && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px 38px',
                background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(20px)',
                overflowX: 'auto',
              }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginRight: 4, flexShrink: 0 }}>
                  {BRUSH_SIZES.map(s => (
                    <div key={s} className={`bdot${brushSize === s ? ' on' : ''}`}
                      style={{ width: s + 16, height: s + 16 }} onClick={() => setBrushSize(s)}>
                      <div style={{ width: s, height: s, borderRadius: '50%', background: 'white' }} />
                    </div>
                  ))}
                </div>
                {COLORS.map(c => (
                  <div key={c} className={`cdot${color === c ? ' sel' : ''}`}
                    style={{ width: 28, height: 28, background: c }} onClick={() => setColor(c)} />
                ))}
              </div>
            )}

            {/* ── TEXT BAR ─────────────────────────────────────────────── */}
            {tool === 'text' && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 38px',
                background: 'rgba(0,0,0,0.48)', backdropFilter: 'blur(20px)',
              }}>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {COLORS.slice(0, 7).map(c => (
                    <div key={c} className={`cdot${color === c ? ' sel' : ''}`}
                      style={{ width: 22, height: 22, background: c }} onClick={() => setColor(c)} />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <button type="button" className="sz-btn" onClick={() => setTextSize(s => Math.max(16, s - 4))}><Minus size={11} /></button>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', width: 22, textAlign: 'center' }}>{textSize}</span>
                  <button type="button" className="sz-btn" onClick={() => setTextSize(s => Math.min(72, s + 4))}><Plus size={11} /></button>
                </div>
                <input autoFocus value={activeText} onChange={e => setActiveText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addText(); }}
                  placeholder="Type something…"
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: 15, fontFamily: 'DM Sans, sans-serif' }} />
                <button type="button" onClick={addText}
                  style={{ width: 32, height: 32, borderRadius: '50%', background: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <Check size={14} color="black" />
                </button>
              </div>
            )}

            {/* ── VIDEO TRIM ───────────────────────────────────────────── */}
            {mediaKind === 'video' && videoDuration > MAX_VIDEO_DURATION && tool === 'none' && panel === 'none' && (
              <div style={{ position: 'absolute', bottom: 108, left: 0, right: 0, zIndex: 20, padding: '10px 20px', background: 'rgba(0,0,0,0.48)', backdropFilter: 'blur(12px)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{startOffset.toFixed(1)}s</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>30s clip</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.42)' }}>{endOffset.toFixed(1)}s</span>
                </div>
                <input type="range" min={0} max={maxStart} step={0.1} value={startOffset}
                  onChange={e => setStartOffset(parseFloat(e.target.value))} className="scrub" />
              </div>
            )}

            {/* ── BOTTOM ACTION BAR (default mode) ─────────────────────── */}
            {tool === 'none' && panel === 'none' && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
                padding: '0 16px 38px',
                background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.28) 60%, transparent 100%)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Caption tap target */}
                  <button type="button" onClick={() => setPanel('share')}
                    style={{
                      flex: 1, background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(14px)',
                      border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14,
                      padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8,
                      cursor: 'pointer', textAlign: 'left',
                    }}>
                    <AlignCenter size={15} color="rgba(255,255,255,0.45)" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: caption ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.32)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {caption || 'Add a caption…'}
                    </span>
                  </button>
                  {/* Quick share */}
                  <button type="button" onClick={handlePost} disabled={isPosting}
                    style={{
                      height: 46, borderRadius: 14, flexShrink: 0,
                      background: 'linear-gradient(135deg,#FF385C,#FF6B35)',
                      border: 'none', padding: '0 18px',
                      display: 'flex', alignItems: 'center', gap: 6,
                      color: 'white', fontWeight: 700, fontSize: 14, letterSpacing: '-0.2px',
                      cursor: 'pointer', boxShadow: '0 4px 20px rgba(255,56,92,0.5)',
                      opacity: isPosting ? 0.7 : 1,
                    }}>
                    {isPosting
                      ? <><div className="spinner" /><span style={{ fontSize: 13 }}>{uploadStep || '…'}</span></>
                      : <><Sparkles size={16} /><span>Share</span></>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* ── SLIDE-UP PANELS ──────────────────────────────────────── */}
            {/* Backdrop */}
            {panel !== 'none' && (
              <div onClick={() => setPanel('none')}
                style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }} />
            )}

            <div className={`panel ${panel !== 'none' ? 'open' : 'shut'}`}>
              <div className="handle" onClick={() => setPanel('none')} />

              {/* MUSIC */}
              {panel === 'music' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,56,92,0.15)', border: '1px solid rgba(255,56,92,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Music size={18} color="#FF385C" />
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>Add Music</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>Paste a YouTube link</div>
                      </div>
                    </div>
                    <button type="button" onClick={() => setPanel('none')} className="gbtn sm"><X size={15} /></button>
                  </div>

                  <input value={youtubeUrl} onChange={e => { setYoutubeUrl(e.target.value); setYoutubeError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter') confirmMusic(); }}
                    placeholder="https://youtube.com/watch?v=…" className="field" />

                  {youtubeError && <div className="err" style={{ marginTop: 10 }}>{youtubeError}</div>}

                  {youtubeTitle && !youtubeError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,56,92,0.1)', border: '1px solid rgba(255,56,92,0.18)', borderRadius: 12, padding: '10px 14px', marginTop: 10 }}>
                      <Music size={13} color="#FF385C" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{youtubeTitle}</span>
                    </div>
                  )}

                  <button type="button" onClick={confirmMusic} className="conf-btn" style={{ marginTop: 16 }}>
                    {youtubeTitle ? '✓  Confirm song' : 'Add Song'}
                  </button>
                </div>
              )}

              {/* SHARE */}
              {panel === 'share' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'white' }}>Caption & Share</span>
                    <button type="button" onClick={() => setPanel('none')} className="gbtn sm"><X size={15} /></button>
                  </div>

                  <textarea value={caption} onChange={e => setCaption(e.target.value)}
                    placeholder="Write a caption…" rows={3} className="field" />

                  {postError && <div className="err" style={{ marginTop: 12 }}>{postError}</div>}

                  <button type="button" onClick={handlePost} disabled={isPosting} className="share-btn" style={{ marginTop: 16 }}>
                    {isPosting
                      ? <><div className="spinner" /><span style={{ fontSize: 14 }}>{uploadStep || 'Working…'}</span></>
                      : <><Sparkles size={18} /><span>Share your story</span></>
                    }
                  </button>
                </div>
              )}
            </div>

          </div>
        )}

      </div>
    </>
  );
}