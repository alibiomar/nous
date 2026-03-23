'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraOff, Check, Music,
  Pen, RotateCcw, Search, SwitchCamera, Type, Upload, X,
   AlignCenter, Trash2, Clock, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

type Tool  = 'none' | 'draw' | 'text';
type Panel = 'none' | 'music' | 'share';

const COMPRESS_MAX_WIDTH = 1080;
const COMPRESS_QUALITY   = 0.82;
const MAX_VIDEO_DURATION = 30;

const COLORS = [
  '#ffffff', '#000000', '#FF385C', '#FF6B35',
  '#FFD60A', '#30D158', '#64D2FF', '#0A84FF',
  '#BF5AF2', '#FF375F',
];
const BRUSH_SIZES = [3, 6, 12, 20];

interface TextItem {
  id: string; text: string; color: string; size: number;
  x: number; y: number; rotate: number; scale: number;
}

interface YTResult {
  videoId: string; title: string; channelTitle: string;
  thumbnail: string; durationSec: number;
}

interface MusicSelection {
  videoId:     string;
  title:       string;
  channel:     string;
  thumbnail:   string;
  startSec:    number;
  durationSec: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  return new Promise(resolve => {
    const img = new Image(), burl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(burl);
      const s = Math.min(1, COMPRESS_MAX_WIDTH / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => {
        if (!b) { resolve(file); return; }
        const f = new File([b], file.name, { type: 'image/jpeg' });
        resolve(f.size < file.size ? f : file);
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
  isSelfie: boolean
): Promise<Blob> {
  const outW = overlayCanvas.width;
  const outH = overlayCanvas.height;

  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const ctx = out.getContext('2d')!;

  const mediaW = (mediaEl as HTMLVideoElement).videoWidth || (mediaEl as HTMLImageElement).naturalWidth;
  const mediaH = (mediaEl as HTMLVideoElement).videoHeight || (mediaEl as HTMLImageElement).naturalHeight;

  ctx.save();
  // If it's a selfie, horizontally mirror the base media
  if (isSelfie) {
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
  }

  if (mediaW && mediaH) {
    const imgRatio = mediaW / mediaH;
    const canvasRatio = outW / outH;
    let drawW, drawH, drawX = 0, drawY = 0;

    if (imgRatio > canvasRatio) {
      drawH = outH;
      drawW = drawH * imgRatio;
      drawX = (outW - drawW) / 2;
    } else {
      drawW = outW;
      drawH = drawW / imgRatio;
      drawY = (outH - drawH) / 2;
    }
    ctx.drawImage(mediaEl, drawX, drawY, drawW, drawH);
  } else {
    ctx.drawImage(mediaEl, 0, 0, outW, outH);
  }
  
  ctx.restore(); // Restore context so text/edits aren't drawn backwards!

  // Draw edits (pen + text overlays)
  ctx.drawImage(overlayCanvas, 0, 0, outW, outH);

  for (const item of textItems) {
    ctx.save();
    ctx.translate(item.x * outW, item.y * outH);
    ctx.rotate((item.rotate * Math.PI) / 180);
    ctx.scale(item.scale, item.scale);
    ctx.font      = `bold ${item.size}px sans-serif`;
    ctx.fillStyle = item.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth   = 3;
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(item.text, 0, 0);
    ctx.fillText(item.text, 0, 0);
    ctx.restore();
  }

  return new Promise((res, rej) =>
    out.toBlob((b) => b ? res(b) : rej(new Error('Canvas empty')), 'image/jpeg', COMPRESS_QUALITY)
  );
}

function dist2(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay);
}
function angle2(ax: number, ay: number, bx: number, by: number) {
  return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
}

function fmtSec(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton YouTube player
// ─────────────────────────────────────────────────────────────────────────────

let _ytContainer:  HTMLDivElement | null = null;
let _ytPlayer:     any = null;
let _ytReady       = false;
let _ytPendingId:  string | null = null;
let _ytPendingSec  = 0;
let _ytCallbacks:  Array<() => void> = [];

function ensureYTContainer() {
  if (_ytContainer) return;
  _ytContainer = document.createElement('div');
  _ytContainer.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px;left:-9999px;';
  document.body.appendChild(_ytContainer);
}

function loadYTScript() {
  if ((window as any).YT?.Player) { return; }
  if (document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

function onYTReady(cb: () => void) {
  if (_ytReady) { cb(); return; }
  _ytCallbacks.push(cb);
}

if (typeof window !== 'undefined') {
  const prev = (window as any).onYouTubeIframeAPIReady;
  (window as any).onYouTubeIframeAPIReady = () => {
    prev?.();
    _ytReady = true;
    _ytCallbacks.forEach(fn => fn());
    _ytCallbacks = [];
  };
}

function ytLoad(videoId: string, startSec: number) {
  _ytPendingId  = videoId;
  _ytPendingSec = startSec;

  ensureYTContainer();
  loadYTScript();

  const doLoad = () => {
    if (!_ytContainer) return;
    if (_ytPlayer) {
      try {
        _ytPlayer.loadVideoById({ videoId, startSeconds: startSec });
      } catch {}
    } else {
      const div = document.createElement('div');
      _ytContainer.appendChild(div);
      _ytPlayer = new (window as any).YT.Player(div, {
        videoId,
        playerVars: { autoplay: 1, start: Math.floor(startSec), controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady(e: any) {
            e.target.seekTo(_ytPendingSec, true);
            e.target.playVideo();
          },
        },
      });
    }
  };

  onYTReady(doLoad);
}

function ytSeek(startSec: number) {
  _ytPendingSec = startSec;
  try {
    _ytPlayer?.seekTo(startSec, true);
    _ytPlayer?.playVideo();
  } catch {}
}

function ytStop() {
  try { _ytPlayer?.pauseVideo(); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MusicPanel
// ─────────────────────────────────────────────────────────────────────────────

function MusicPanel({
  selection, onConfirm, onClear, onClose,
}: {
  selection: MusicSelection | null;
  onConfirm: (s: MusicSelection) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState<YTResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [picked, setPicked]       = useState<YTResult | null>(null);
  const [startSec, setStartSec]   = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { ytStop(); }, []);

  useEffect(() => {
    if (selection) {
      setPicked({ videoId: selection.videoId, title: selection.title, channelTitle: selection.channel, thumbnail: selection.thumbnail, durationSec: selection.durationSec });
      setStartSec(selection.startSec);
    }
  }, []); // eslint-disable-line

  const handleQueryChange = (val: string) => {
    setQuery(val); setSearchErr('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/youtube/search?q=${encodeURIComponent(val.trim())}`);
        const data = await res.json();
        if (!res.ok) { setSearchErr(data.error ?? 'Search failed'); setResults([]); }
        else setResults(Array.isArray(data) ? data : []);
      } catch { setSearchErr('Search failed'); }
      finally { setSearching(false); }
    }, 500);
  };

  const selectVideo = (v: YTResult) => {
    setPicked(v); setStartSec(0); setResults([]); setQuery('');
    setPreviewing(false); ytStop();
  };

  const confirm = () => {
    if (!picked) return;
    onConfirm({ videoId: picked.videoId, title: picked.title, channel: picked.channelTitle, thumbnail: picked.thumbnail, startSec, durationSec: picked.durationSec });
  };

  const dur      = picked?.durationSec ?? 0;
  const maxStart = Math.max(0, dur - 30);
  const endSec   = Math.min(startSec + 30, dur > 0 ? dur : startSec + 30);
  const windowPct = dur > 0 ? (30 / dur) * 100 : 100;
  const startPct  = dur > 0 ? (startSec / dur) * 100 : 0;

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-border/60 bg-primary/10 p-2">
            <Music className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Add Music</p>
            <p className="text-xs text-muted-foreground">Search any song or artist</p>
          </div>
        </div>
        <button type="button" onClick={onClose}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!picked && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input autoFocus value={query} onChange={e => handleQueryChange(e.target.value)}
            placeholder="Song name, artist, lyrics…"
            className="w-full h-11 rounded-2xl border border-border/70 bg-background/60 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors" />
          {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />}
        </div>
      )}

      {searchErr && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{searchErr}</p>}

      {results.length > 0 && !picked && (
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5" style={{ scrollbarWidth: 'thin' }}>
          {results.map(v => (
            <button key={v.videoId} type="button" onClick={() => selectVideo(v)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/50 p-2.5 text-left hover:bg-muted/40 transition-colors">
              {v.thumbnail
                ? <img src={v.thumbnail} alt="" className="h-11 w-18 rounded-xl object-cover shrink-0" />
                : <div className="h-11 w-18 rounded-xl bg-muted/60 flex items-center justify-center shrink-0"><Music className="h-4 w-4 text-muted-foreground" /></div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground line-clamp-1">{v.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{v.channelTitle}</p>
                {v.durationSec > 0 && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{fmtSec(v.durationSec)}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/8 p-2.5">
            {picked.thumbnail
              ? <img src={picked.thumbnail} alt="" className="h-11 w-18 rounded-xl object-cover shrink-0" />
              : <div className="h-11 w-18 rounded-xl bg-muted/60 flex items-center justify-center shrink-0"><Music className="h-5 w-5 text-muted-foreground" /></div>
            }
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground line-clamp-1">{picked.title}</p>
              <p className="text-xs text-muted-foreground line-clamp-1">{picked.channelTitle}</p>
              {picked.durationSec > 0 && <p className="text-[11px] text-muted-foreground/60">{fmtSec(picked.durationSec)}</p>}
            </div>
            <button type="button" onClick={() => { setPicked(null); setStartSec(0); setPreviewing(false); ytStop(); }}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-foreground">30s clip window</p>
              </div>
              <span className="text-xs font-medium tabular-nums text-foreground">
                {fmtSec(startSec)} – {fmtSec(endSec)}
              </span>
            </div>

            <div className="relative h-5 flex items-center">
              <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted/60" />
              <div
                className="absolute h-1.5 rounded-full bg-primary/70"
                style={{ left: `${startPct}%`, width: `${Math.min(windowPct, 100 - startPct)}%` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-primary border-2 border-background shadow -translate-x-1/2 cursor-pointer"
                style={{ left: `${startPct}%` }}
              />
              <div
                className="absolute w-2.5 h-2.5 rounded-full bg-primary/50 border-2 border-background shadow -translate-x-1/2"
                style={{ left: `${Math.min(startPct + windowPct, 100)}%` }}
              />
            </div>

            <input
              type="range"
              min={0}
              max={maxStart}
              step={1}
              value={startSec}
              onChange={e => {
                const v = +e.target.value;
                setStartSec(v);
                if (previewing && picked) ytSeek(v);
              }}
              className="w-full accent-primary h-1 cursor-pointer"
              disabled={maxStart === 0}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/55">
              <span>0:00</span>
              <span className="text-muted-foreground/70 font-medium">Drag to choose start · end auto-locks at +30s</span>
              <span>{dur > 0 ? fmtSec(dur) : '?'}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!picked) return;
                if (previewing) {
                  ytStop();
                  setPreviewing(false);
                } else {
                  ytLoad(picked.videoId, startSec);
                  setPreviewing(true);
                }
              }}
              className={[
                'flex items-center gap-2 w-full justify-center rounded-xl border py-2 text-xs font-medium transition-colors',
                previewing
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-muted/40',
              ].join(' ')}
            >
              <Music className={['h-3.5 w-3.5', previewing ? 'animate-pulse' : ''].join(' ')} />
              {previewing ? `Previewing from ${fmtSec(startSec)}…` : 'Preview this clip'}
            </button>
          </div>

          <div className="flex gap-2">
            {selection && (
              <button type="button" onClick={onClear}
                className="flex-1 rounded-2xl border border-border/70 bg-background/50 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
                Remove
              </button>
            )}
            <Button onClick={confirm} className={`rounded-2xl h-11 gap-1.5 ${selection ? 'flex-1' : 'w-full'}`}>
              <Music className="h-4 w-4" />
              {selection ? 'Update' : 'Add to story'}
            </Button>
          </div>
        </div>
      )}

      {!picked && results.length === 0 && !searching && !searchErr && (
        <div className="text-center py-6">
          <Music className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground/50">Search for a song to add to your story</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TextLabel — drag (PC pointer) + pinch/rotate (touch)
// ─────────────────────────────────────────────────────────────────────────────

interface TextLabelProps {
  item: TextItem;
  stageRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
  onActivate: (id: string) => void;
  onDeactivate: () => void;
  onChange: (id: string, patch: Partial<TextItem>) => void;
}

function TextLabel({ item, stageRef, active, onActivate, onDeactivate, onChange }: TextLabelProps) {
  const elRef = useRef<HTMLSpanElement | null>(null);
  const itemRef = useRef(item);

  // Maintain reference to latest item avoiding stale closures in touch events
  useEffect(() => {
    itemRef.current = item;
  }, [item]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault(); e.stopPropagation();
    onActivate(itemRef.current.id);
    const stage = stageRef.current; if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const snapX = itemRef.current.x, snapY = itemRef.current.y;
    const sx = e.clientX, sy = e.clientY;
    
    const onMove = (ev: globalThis.PointerEvent) => {
      onChange(itemRef.current.id, {
        x: Math.max(0, Math.min(1, snapX + (ev.clientX - sx) / rect.width)),
        y: Math.max(0, Math.min(1, snapY + (ev.clientY - sy) / rect.height)),
      });
    };
    
    const onUp = () => {
      onDeactivate();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onChange, onActivate, onDeactivate, stageRef]);

  useEffect(() => {
    const el = elRef.current; const stage = stageRef.current;
    if (!el || !stage) return;

    let snapX = 0, snapY = 0, snapRot = 0;
    let snapAng = 0, snapCX = 0, snapCY = 0;

    const rect = () => stage.getBoundingClientRect();

    const onStart = (e: TouchEvent) => {
      e.stopPropagation();
      const currentItem = itemRef.current;
      onActivate(currentItem.id);
      snapX = currentItem.x; snapY = currentItem.y;
      snapRot = currentItem.rotate;
      
      if (e.touches.length >= 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        snapAng  = angle2(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
        snapCX   = (t0.clientX + t1.clientX) / 2;
        snapCY   = (t0.clientY + t1.clientY) / 2;
      } else {
        snapCX = e.touches[0].clientX;
        snapCY = e.touches[0].clientY;
      }
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault(); e.stopPropagation();
      const r = rect();
      const currentItem = itemRef.current;
      
      if (e.touches.length >= 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const curAng  = angle2(t0.clientX, t0.clientY, t1.clientX, t1.clientY);
        const curCX   = (t0.clientX + t1.clientX) / 2;
        const curCY   = (t0.clientY + t1.clientY) / 2;
        onChange(currentItem.id, {
          rotate: snapRot + (curAng - snapAng),
          x: Math.max(0, Math.min(1, snapX + (curCX - snapCX) / r.width)),
          y: Math.max(0, Math.min(1, snapY + (curCY - snapCY) / r.height)),
        });
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        onChange(currentItem.id, {
          x: Math.max(0, Math.min(1, snapX + (t.clientX - snapCX) / r.width)),
          y: Math.max(0, Math.min(1, snapY + (t.clientY - snapCY) / r.height)),
        });
      }
    };

    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      if (e.touches.length === 0) onDeactivate();
      if (e.touches.length === 1) {
        snapCX = e.touches[0].clientX; snapCY = e.touches[0].clientY;
        snapX = itemRef.current.x; snapY = itemRef.current.y;
      }
    };

    el.addEventListener('touchstart',  onStart, { passive: false });
    el.addEventListener('touchmove',   onMove,  { passive: false });
    el.addEventListener('touchend',    onEnd,   { passive: false });
    el.addEventListener('touchcancel', onEnd,   { passive: false });
    
    return () => {
      el.removeEventListener('touchstart',  onStart);
      el.removeEventListener('touchmove',   onMove);
      el.removeEventListener('touchend',    onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [onActivate, onDeactivate, onChange, stageRef]);

  return (
    <span
      ref={elRef}
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute', zIndex: 15,
        left: `${item.x * 100}%`, top: `${item.y * 100}%`,
        transform: `translate(-50%,-50%) rotate(${item.rotate}deg) scale(${item.scale})`,
        color: item.color, fontSize: item.size, fontWeight: 700,
        textShadow: '0 2px 10px rgba(0,0,0,0.65)',
        touchAction: 'none', userSelect: 'none', cursor: 'grab', willChange: 'transform',
        outline: active ? '2px solid rgba(255,255,255,0.55)' : 'none',
        outlineOffset: '6px', borderRadius: 4, whiteSpace: 'nowrap',
      }}
    >{item.text}</span>
  );
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
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function StoryCreator({ open, onClose, onPosted }: StoryCreatorProps) {

  // ── Media ──────────────────────────────────────────────────────────────────
  const [mediaFile, setMediaFile]         = useState<File | null>(null);
  const [mediaPreview, setMediaPreview]   = useState<string | null>(null);
  const [mediaKind, setMediaKind]         = useState<'image' | 'video'>('image');
  const [videoDuration, setVideoDuration] = useState(0);
  const [startOffset, setStartOffset]     = useState(0);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isRecording, setIsRecording]   = useState(false);
  const [cameraError, setCameraError]   = useState(false);
  const [isSelfie, setIsSelfie]         = useState(false);
  
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRecRef    = useRef<MediaRecorder | null>(null);
  const recordChunks   = useRef<Blob[]>([]);
  const holdTimeout    = useRef<NodeJS.Timeout | null>(null);

  // ── Tools ──────────────────────────────────────────────────────────────────
  const [tool, setTool]             = useState<Tool>('none');
  const [color, setColor]           = useState('#ffffff');
  const [brushSize, setBrushSize]   = useState(6);
  const [textItems, setTextItems]   = useState<TextItem[]>([]);
  const [activeText, setActiveText] = useState('');
  const [textSize, setTextSize]     = useState(32);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // ── Canvas ─────────────────────────────────────────────────────────────────
  const canvasRef  = useRef<HTMLCanvasElement | null>(null);
  const editImgRef = useRef<HTMLImageElement | null>(null);
  const editVidRef = useRef<HTMLVideoElement | null>(null);
  const stageRef   = useRef<HTMLDivElement | null>(null);
  const undoStack  = useRef<ImageData[]>([]);
  const isDrawing  = useRef(false);
  const lastPt     = useRef({ x: 0, y: 0 });
  const ptBuf      = useRef<{ x: number; y: number }[]>([]);

  const colorRef     = useRef(color);
  const brushSizeRef = useRef(brushSize);
  const toolRef      = useRef(tool);
  useEffect(() => { colorRef.current = color; },         [color]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { toolRef.current = tool; },           [tool]);

  // ── Music ──────────────────────────────────────────────────────────────────
  const [musicSelection, setMusicSelection] = useState<MusicSelection | null>(null);
  // ── Panels & share ─────────────────────────────────────────────────────────
  const [panel, setPanel]           = useState<Panel>('none');
  const [caption, setCaption]       = useState('');
  const [isPosting, setIsPosting]   = useState(false);
  const [uploadStep, setUploadStep] = useState('');
  const [postError, setPostError]   = useState('');

  useEffect(() => {
    if (musicSelection && panel === 'none' && mediaPreview) {
      ytLoad(musicSelection.videoId, musicSelection.startSec);
    } else {
      ytStop();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicSelection?.videoId, musicSelection?.startSec, panel, mediaPreview]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (open) setTimeout(() => setVisible(true), 10);
    else setVisible(false);
  }, [open]);

  // ── Body scroll lock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setCameraStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    setCameraActive(false); setCameraError(false);
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null); setMediaPreview(null); setMediaKind('image');
    setVideoDuration(0); setStartOffset(0); setIsSelfie(false);
    setTool('none'); setTextItems([]); setActiveText(''); setActiveItemId(null);
    setPanel('none'); setMusicSelection(null); ytStop();
    setCaption(''); setIsPosting(false); setUploadStep(''); setPostError('');
    undoStack.current = [];
  }, [mediaPreview]);

  useEffect(() => { if (!open) reset(); }, [open, reset]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    setCameraStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async (facing: 'user' | 'environment') => {
    setCameraError(false);
    setCameraStream(prev => { prev?.getTracks().forEach(t => t.stop()); return null; });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: true,
      });
      setCameraStream(stream); setCameraActive(true);
      const vid = cameraVideoRef.current;
      if (vid) {
        vid.srcObject = stream;
        await vid.play();
      }
    } catch {
      setCameraError(true);
    }
  }, []);

  const flipCamera = useCallback(() => {
    setCameraFacing(f => f === 'user' ? 'environment' : 'user');
  }, []);

  useEffect(() => {
    if (open && !mediaPreview) {
      startCamera(cameraFacing);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cameraFacing]);

  const capturePhoto = useCallback(() => {
    const vid = cameraVideoRef.current; if (!vid) return;
    const c = document.createElement('canvas');
    c.width = vid.videoWidth; c.height = vid.videoHeight;
    const ctx = c.getContext('2d')!;
    
    // We capture raw un-mirrored bytes directly from the sensor.
    // The CSS handles the visual flip, we will handle the actual file flip in `flattenToBlob` before upload.
    ctx.drawImage(vid, 0, 0);

    c.toBlob(blob => {
      if (!blob) return;
      setIsSelfie(cameraFacing === 'user');
      stopCamera();
      loadMedia(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  }, [stopCamera, cameraFacing]);

  const startRecording = useCallback(() => {
    if (!cameraStream) return;
    recordChunks.current = [];
    const rec = new MediaRecorder(cameraStream, { mimeType: 'video/webm' });
    rec.ondataavailable = e => { if (e.data.size > 0) recordChunks.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(recordChunks.current, { type: 'video/webm' });
      setIsSelfie(cameraFacing === 'user');
      stopCamera();
      loadMedia(new File([blob], 'capture.webm', { type: 'video/webm' }));
    };
    rec.start(); mediaRecRef.current = rec; setIsRecording(true);
    setTimeout(() => stopRecording(), MAX_VIDEO_DURATION * 1000);
  }, [cameraStream, stopCamera, cameraFacing]);

  const stopRecording = useCallback(() => {
    mediaRecRef.current?.stop(); mediaRecRef.current = null; setIsRecording(false);
  }, []);

  // ── Load media ─────────────────────────────────────────────────────────────
  const loadMedia = useCallback((file: File) => {
    if (file.type.startsWith('image/')) {
      setMediaKind('image'); setMediaPreview(URL.createObjectURL(file)); setMediaFile(file);
    } else if (file.type.startsWith('video/')) {
      setMediaKind('video');
      const url = URL.createObjectURL(file);
      const vid = document.createElement('video'); vid.src = url;
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

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !mediaPreview) return;
    const ctx = canvas.getContext('2d')!;
    const pt = (e: globalThis.PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: globalThis.PointerEvent) => {
      if (toolRef.current !== 'draw') return;
      e.preventDefault(); isDrawing.current = true;
      const p = pt(e); lastPt.current = p; ptBuf.current = [p];
      canvas.setPointerCapture(e.pointerId);
      ctx.beginPath(); ctx.arc(p.x, p.y, brushSizeRef.current / 2, 0, Math.PI * 2);
      ctx.fillStyle = colorRef.current; ctx.fill();
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (!isDrawing.current || toolRef.current !== 'draw') return;
      e.preventDefault();
      const p = pt(e); ptBuf.current.push(p);
      if (ptBuf.current.length > 3) ptBuf.current.shift();
      ctx.beginPath(); ctx.strokeStyle = colorRef.current; ctx.lineWidth = brushSizeRef.current;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.moveTo(lastPt.current.x, lastPt.current.y);
      const buf = ptBuf.current;
      if (buf.length >= 2) {
        const mid = { x: (buf[buf.length-2].x + buf[buf.length-1].x)/2, y: (buf[buf.length-2].y + buf[buf.length-1].y)/2 };
        ctx.quadraticCurveTo(lastPt.current.x, lastPt.current.y, mid.x, mid.y);
        lastPt.current = mid;
      } else { ctx.lineTo(p.x, p.y); lastPt.current = p; }
      ctx.stroke();
    };
    const onUp = (e: globalThis.PointerEvent) => {
      if (!isDrawing.current) return; e.preventDefault();
      isDrawing.current = false; ptBuf.current = [];
    };
    canvas.addEventListener('pointerdown',   onDown, { passive: false });
    canvas.addEventListener('pointermove',   onMove, { passive: false });
    canvas.addEventListener('pointerup',     onUp,   { passive: false });
    canvas.addEventListener('pointercancel', onUp,   { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown',   onDown);
      canvas.removeEventListener('pointermove',   onMove);
      canvas.removeEventListener('pointerup',     onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [mediaPreview]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas || !mediaPreview) return;
    const onDown = () => {
      if (toolRef.current !== 'draw') return;
      const ctx = canvas.getContext('2d')!;
      undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.current.length > 20) undoStack.current.shift();
    };
    canvas.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    return () => canvas.removeEventListener('pointerdown', onDown, { capture: true });
  }, [mediaPreview]);

  const undo = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !undoStack.current.length) return;
    c.getContext('2d')!.putImageData(undoStack.current.pop()!, 0, 0);
  }, []);

  // ── Text ───────────────────────────────────────────────────────────────────
  const addText = useCallback(() => {
    if (!activeText.trim()) return;
    setTextItems(p => [...p, { id: crypto.randomUUID(), text: activeText.trim(), color, size: textSize, x: 0.5, y: 0.45, rotate: 0, scale: 1 }]);
    setActiveText(''); setTool('none');
  }, [activeText, color, textSize]);

  const handleTextChange = useCallback((id: string, patch: Partial<TextItem>) => {
    setTextItems(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // ── Post ───────────────────────────────────────────────────────────────────
  const uploadFile = async (file: File, startOff = 0, uploadAsSelfie = false) => {
    const fd = new FormData();
    fd.append('file', file);
    if (file.type.startsWith('video/')) fd.append('startOffset', startOff.toString());
    
    // Only pass isSelfie flag to Cloudinary if requested (mostly for video where we can't burn the flip in client)
    if (uploadAsSelfie) fd.append('isSelfie', 'true');
    
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
        const hasDrawOrText = undoStack.current.length > 0 || textItems.length > 0;
        
        // If it's a selfie or has edits, we need to flatten the image canvas 
        // to bake in the CSS transform and text edits
        if (hasDrawOrText || isSelfie) {
          setUploadStep(hasDrawOrText ? 'Rendering edits…' : 'Processing image…');
          const blob = await flattenToBlob(editImgRef.current!, canvasRef.current!, textItems, isSelfie);
          imageFile = await compressImage(new File([blob], 'story.jpg', { type: 'image/jpeg' }));
        } else {
          setUploadStep('Preparing…');
          imageFile = await compressImage(mediaFile);
        }
      } else {
        setUploadStep('Creating thumbnail…');
        const vid = editVidRef.current!;
        const t = document.createElement('canvas');
        t.width = vid.videoWidth || 480; t.height = vid.videoHeight || 854;
        const ctx = t.getContext('2d')!;
        
        // Mirror the thumbnail natively so it matches the requested Cloudinary flipped video
        if (isSelfie) {
          ctx.translate(t.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(vid, 0, 0, t.width, t.height);
        const tb = await new Promise<Blob>(r => t.toBlob(b => r(b!), 'image/jpeg', 0.85));
        imageFile = new File([tb], 'thumb.jpg', { type: 'image/jpeg' });
        videoFile = mediaFile;
      }
      setUploadStep('Uploading…');
      
      // Send isSelfie = false since we already physically mirrored the image file in the logic above
      const imgR = await uploadFile(imageFile, 0, false); 
      if (!imgR) return;
      
      let videoUrl: string | null = null, videoPublicId: string | null = null;
      if (videoFile) {
        // Send isSelfie = true so Cloudinary backend transforms the video, since we don't edit it client-side
        const vidR = await uploadFile(videoFile, startOffset, isSelfie); 
        if (!vidR) return;
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
          youtube_video_id:  musicSelection?.videoId  ?? null,
          youtube_title:     musicSelection?.title    ?? null,
          youtube_start_sec: musicSelection?.startSec ?? null,
          youtube_end_sec:   musicSelection ? musicSelection.startSec + 30 : null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); setPostError(d?.error || 'Failed'); return; }
      reset(); onPosted?.(); onClose();
    } catch { setPostError('Something went wrong.'); }
    finally { setIsPosting(false); setUploadStep(''); }
  };

  // ── Shutter Button Logic ───────────────────────────────────────────────────
  const handleShutterDown = () => {
    if (!cameraActive) return;
    holdTimeout.current = setTimeout(() => {
      holdTimeout.current = null;
      if (!isRecording) startRecording();
    }, 300); // Trigger record on a slight hold (300ms)
  };

  const handleShutterUp = () => {
    if (holdTimeout.current) {
      // Timeout hasn't fired yet -> Treat as a photo tap
      clearTimeout(holdTimeout.current);
      holdTimeout.current = null;
      if (cameraActive && !isRecording) capturePhoto();
    } else {
      // Timeout fired -> Treat as recording stop
      if (isRecording) stopRecording();
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (!open) return null;

  const hasMedia   = !!mediaPreview;
  const maxStart   = Math.max(0, videoDuration - MAX_VIDEO_DURATION);
  const endOffset  = Math.min(startOffset + MAX_VIDEO_DURATION, videoDuration);
  const hasEdits   = undoStack.current.length > 0 || textItems.length > 0;
  const inToolMode = tool === 'draw' || tool === 'text';

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 h-screen z-200 flex flex-col bg-background/80 backdrop-blur-sm"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'opacity 0.25s ease, transform 0.42s cubic-bezier(0.32,0.72,0,1)',
      }}
    >
      {/* ══════════════════ CAMERA SCREEN (shown when no media selected yet) ══════════════════ */}
      {!hasMedia && (
        <div className="relative flex flex-col h-full bg-black">

          {/* Camera viewfinder — full screen */}
          <video
            ref={cameraVideoRef}
            className="absolute inset-0 h-full w-full object-cover transition-transform"
            style={cameraFacing === 'user' ? { transform: 'scaleX(-1)' } : undefined}
            autoPlay
            playsInline
            muted
          />

          {/* Dim overlay when camera failed */}
          {cameraError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 gap-3 z-10">
              <CameraOff className="h-10 w-10 text-white/40" />
              <p className="text-sm text-white/50">Camera unavailable</p>
            </div>
          )}

          {/* Gradient overlays */}
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-black/40 z-10" />

          {/* ── TOP: close + flip ── */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-12 pb-4 z-20">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/20 bg-black/40 p-2.5 text-white backdrop-blur-sm"
            >
              <X className="h-5 w-5" />
            </button>

            {isRecording && (
              <div className="flex items-center gap-1.5 rounded-full bg-destructive/85 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                REC
              </div>
            )}

            <button
              type="button"
              onClick={flipCamera}
              className="rounded-full border border-white/20 bg-black/40 p-2.5 text-white backdrop-blur-sm"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          </div>

          {/* ── BOTTOM: upload (left) + shutter (center) ── */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-8 pb-14 pt-6 z-20">

            {/* Gallery / upload button — bottom left */}
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { stopCamera(); loadMedia(f); }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1.5"
              >
                <div
                  className="rounded-2xl border-2 border-white/40 flex items-center justify-center overflow-hidden transition-opacity hover:opacity-80 bg-black/45"
                  style={{ width: 48, height: 48 }}
                >
                  <Upload className="h-5 w-5 text-white/70" />
                </div>
                <span className="text-[10px] text-white/55 font-medium">Gallery</span>
              </button>
            </>

            {/* Shutter button — center */}
            <button
              type="button"
              onPointerDown={handleShutterDown}
              onPointerUp={handleShutterUp}
              onPointerLeave={handleShutterUp}
              className={[
                'h-20 w-20 rounded-full border-4 transition-all duration-150 flex items-center justify-center',
                isRecording
                  ? 'border-destructive/80 bg-destructive/20 scale-95'
                  : 'border-white/80 bg-white/10',
              ].join(' ')}
            >
              {!isRecording && <div className="h-14 w-14 rounded-full bg-white/90" />}
              {isRecording  && <div className="h-6 w-6 rounded-md bg-destructive" />}
            </button>

            {/* Right spacer — keeps shutter centered */}
            <div className="w-14" />
          </div>
        </div>
      )}

      {/* ══════════════════ MEDIA STAGE ══════════════════ */}
      {hasMedia && (
        <div
          ref={stageRef}
          className="relative w-full h-full overflow-hidden"
          style={{ touchAction: tool === 'draw' ? 'none' : 'auto' }}
        >
          {/* Media */}
          {mediaKind === 'image'
            ? <img ref={editImgRef} src={mediaPreview!} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover transition-transform" style={isSelfie ? { transform: 'scaleX(-1)' } : undefined} />
            : <video ref={editVidRef} src={mediaPreview!} autoPlay playsInline loop muted className="absolute inset-0 h-full w-full object-cover transition-transform" style={isSelfie ? { transform: 'scaleX(-1)' } : undefined} />
          }

          {/* Draw canvas */}
          <canvas ref={canvasRef} className="absolute inset-0"
            style={{ zIndex: 10, pointerEvents: tool === 'draw' ? 'auto' : 'none', cursor: tool === 'draw' ? 'crosshair' : 'default', touchAction: 'none' }} />

          {/* Text labels */}
          {textItems.map(item => (
            <TextLabel key={item.id} item={item} stageRef={stageRef}
              active={activeItemId === item.id}
              onActivate={setActiveItemId}
              onDeactivate={() => setActiveItemId(null)}
              onChange={handleTextChange}
            />
          ))}

          {/* ── TOP BAR ── */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-12 pb-5 pointer-events-none"
            style={{ zIndex: 30, background: 'linear-gradient(to bottom, rgba(0,0,0,0.48) 0%, transparent 100%)' }}>
            <button type="button" onClick={reset}
              className="pointer-events-auto rounded-full border border-white/20 bg-black/35 p-2 text-white backdrop-blur-sm hover:bg-black/55 transition-colors">
              <X className="h-4 w-4" />
            </button>

            {/* Music badge */}
            {musicSelection && !inToolMode && panel === 'none' ? (
              <button type="button" onClick={() => setPanel('music')}
                className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/22 bg-black/40 pl-1 pr-3 py-1 text-xs text-white backdrop-blur-sm max-w-50">
                {musicSelection.thumbnail && (
                  <img src={musicSelection.thumbnail} alt="" className="h-7 w-10 rounded-full object-cover shrink-0" />
                )}
                <span className="truncate">{musicSelection.title}</span>
                {musicSelection.startSec > 0 && (
                  <span className="text-white/50 shrink-0">{fmtSec(musicSelection.startSec)}</span>
                )}
              </button>
            ) : <div />}

            <div className="pointer-events-auto flex items-center gap-1.5">
              {tool === 'draw' && (
                <button type="button" onClick={undo}
                  className="rounded-full border border-white/20 bg-black/35 p-2 text-white backdrop-blur-sm">
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              {inToolMode && (
                <button type="button" onClick={() => { setTool('none'); setActiveText(''); }}
                  className="rounded-full border border-white/80 bg-white/90 px-4 py-1.5 text-xs font-semibold text-black">
                  Done
                </button>
              )}
              {!inToolMode && <div className="w-9" />}
            </div>
          </div>

          {/* ── LEFT: brush sizes ── */}
          {tool === 'draw' && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3" style={{ zIndex: 30 }}>
              {BRUSH_SIZES.map(s => (
                <button key={s} type="button" onClick={() => setBrushSize(s)}
                  className={['rounded-full border-2 flex items-center justify-center transition-all', brushSize === s ? 'border-white' : 'border-white/35'].join(' ')}
                  style={{ width: s + 18, height: s + 18 }}>
                  <div className="rounded-full bg-white" style={{ width: s, height: s }} />
                </button>
              ))}
            </div>
          )}

          {/* ── RIGHT: colors ── */}
          {(tool === 'draw' || tool === 'text') && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5" style={{ zIndex: 30 }}>
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className="rounded-full border-2 transition-all"
                  style={{
                    width: 28, height: 28, background: c,
                    borderColor: color === c ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.2)',
                    transform: color === c ? 'scale(1.25)' : 'scale(1)',
                    boxShadow: color === c ? '0 0 0 2px rgba(0,0,0,0.3)' : 'none',
                  }} />
              ))}
            </div>
          )}

          {/* ── TEXT BAR ── */}
          {tool === 'text' && (
            <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-3 py-3 pb-9"
              style={{ zIndex: 20, background: 'rgba(0,0,0,0.44)', backdropFilter: 'blur(16px)' }}>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setTextSize(s => Math.max(16, s - 4))} className="rounded-full bg-white/10 px-2 py-1 text-white text-xs font-bold">A</button>
                <span className="w-6 text-center text-xs text-white/60">{textSize}</span>
                <button type="button" onClick={() => setTextSize(s => Math.min(72, s + 4))} className="rounded-full bg-white/10 px-2 py-1 text-white text-base font-bold leading-none">A</button>
              </div>
              <input autoFocus value={activeText}
                onChange={e => setActiveText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addText(); }}
                placeholder="Type something…"
                className="flex-1 bg-transparent text-white placeholder:text-white/35 text-sm outline-none" />
              <button type="button" onClick={addText} className="rounded-full bg-white p-1.5 text-black shrink-0">
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* ── IDLE RIGHT TOOLBAR ── */}
          {tool === 'none' && panel === 'none' && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-2" style={{ zIndex: 30 }}>
              <button type="button" onClick={() => setTool('draw')}
                className="rounded-full border border-white/20 bg-black/38 p-2.5 text-white backdrop-blur-sm hover:bg-black/55 transition-colors">
                <Pen className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setTool('text')}
                className="rounded-full border border-white/20 bg-black/38 p-2.5 text-white backdrop-blur-sm hover:bg-black/55 transition-colors">
                <Type className="h-4 w-4" />
              </button>
              {hasEdits && (
                <button type="button"
                  onClick={() => { const c = canvasRef.current; if (c) c.getContext('2d')!.clearRect(0,0,c.width,c.height); setTextItems([]); undoStack.current = []; }}
                  className="rounded-full border border-white/20 bg-black/38 p-2.5 text-white backdrop-blur-sm hover:bg-black/55 transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={() => setPanel('music')}
                className={['rounded-full border p-2.5 backdrop-blur-sm transition-colors',
                  musicSelection ? 'border-primary/50 bg-primary/20 text-primary' : 'border-white/20 bg-black/38 text-white hover:bg-black/55'].join(' ')}>
                <Music className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── VIDEO TRIM ── */}
          {mediaKind === 'video' && videoDuration > MAX_VIDEO_DURATION && tool === 'none' && panel === 'none' && (
            <div className="absolute left-0 right-0 px-4 py-3"
              style={{ zIndex: 20, bottom: 100, background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(10px)' }}>
              <div className="flex justify-between text-[10px] text-white/50 mb-1.5">
                <span>{startOffset.toFixed(1)}s</span>
                <span className="text-white/65 font-medium">30s clip</span>
                <span>{endOffset.toFixed(1)}s</span>
              </div>
              <input type="range" min={0} max={maxStart} step={0.1} value={startOffset}
                onChange={e => setStartOffset(parseFloat(e.target.value))} className="w-full accent-primary h-1" />
            </div>
          )}

          {/* ── BOTTOM ACTION BAR ── */}
          {tool === 'none' && panel === 'none' && (
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-9 pt-10"
              style={{ zIndex: 20, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.2) 55%, transparent 100%)' }}>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setPanel('share')}
                  className="flex flex-1 items-center gap-2.5 rounded-2xl border border-white/18 bg-black/30 px-4 py-3 text-left backdrop-blur-sm hover:bg-black/42 transition-colors">
                  <AlignCenter className="h-4 w-4 text-white/42 shrink-0" />
                  <span className={['text-sm truncate', caption ? 'text-white/80' : 'text-white/35'].join(' ')}>
                    {caption || 'Add a caption…'}
                  </span>
                </button>
                <Button onClick={handlePost} disabled={isPosting} className="h-11 gap-1.5 rounded-2xl px-5 shrink-0">
                  {isPosting
                    ? <><img src="/animated_heart_icon.svg" alt="" className="h-4 w-4" /><span className="text-sm">{uploadStep || '…'}</span></>
                    : <span> Share </span>
                  }
                </Button>
              </div>
            </div>
          )}

          {/* ── PANEL SCRIM ── */}
          {panel !== 'none' && (
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" style={{ zIndex: 40 }} onClick={() => setPanel('none')} />
          )}

          {/* ── SLIDE-UP PANELS ── */}
          <div
            className="glass-panel absolute left-0 right-0 bottom-0 rounded-t-3xl border-t border-border/60 px-5 pb-10"
            style={{ zIndex: 50, transform: panel !== 'none' ? 'translateY(0)' : 'translateY(110%)', transition: 'transform 0.38s cubic-bezier(0.32,0.72,0,1)' }}
          >
            <div className="mx-auto mt-3 mb-5 h-1 w-9 rounded-full bg-border cursor-pointer" onClick={() => setPanel('none')} />

            {panel === 'music' && (
              <MusicPanel
                selection={musicSelection}
                onConfirm={sel => { setMusicSelection(sel); setPanel('none'); }}
                onClear={() => { setMusicSelection(null); setPanel('none'); }}
                onClose={() => setPanel('none')}
              />
            )}

            {panel === 'share' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Caption & Share</p>
                  <button type="button" onClick={() => setPanel('none')}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea value={caption} onChange={e => setCaption(e.target.value)}
                  placeholder="Write a caption…" rows={3}
                  className="w-full resize-none rounded-2xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground backdrop-blur-sm focus:outline-none focus:border-primary/40 transition-colors" />
                {postError && (
                  <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{postError}</p>
                )}
                <Button onClick={handlePost} disabled={isPosting} className="w-full h-12 rounded-2xl text-base font-semibold gap-2">
                  {isPosting
                    ? <><img src="/animated_heart_icon.svg" alt="" className="h-4 w-4" />{uploadStep || 'Working…'}</>
                    : <span>Share your story</span>
                  }
                </Button>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}