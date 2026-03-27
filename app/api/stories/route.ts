import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/auth';
import { sanitizeText, validateYouTubeId } from '@/lib/sanitize';
import { decryptFields } from '@/lib/db-encryption';

const supabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const MAX_IMAGE_SIZE     = 10 * 1024 * 1024;   // 10 MB
const MAX_VIDEO_SIZE     = 50 * 1024 * 1024;  // 50 MB
const MAX_VIDEO_DURATION = 30;                // seconds

// ── Cloudinary helpers ────────────────────────────────────────────────────────

function createCloudinarySignature(params: Record<string, string>, apiSecret: string) {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return createHash('sha1').update(`${sortedParams}${apiSecret}`).digest('hex');
}

function applyImageTransformations(url: string, isSelfie: boolean): string {
  // ar_9:16,c_fill  → center-crop to portrait 9:16 (stories are full-screen vertical)
  // w_1080          → cap width at 1080 px
  // q_auto,f_auto   → optimised quality + format
  // a_hflip         → flip selfie (front-camera) images back to natural orientation
  const flip = isSelfie ? ',a_hflip' : '';
  return url.replace(
    '/image/upload/',
    `/image/upload/ar_9:16,c_fill,w_1080,q_auto,f_auto${flip}/`,
  );
}

function applyVideoTransformations(url: string): string {
  return url.replace('/video/upload/', '/video/upload/q_auto,f_auto/');
}

async function uploadToCloudinary(
  file: File,
  resourceType: 'image' | 'video',
  extraParams: Record<string, string> = {},
): Promise<{ secure_url: string; public_id: string; duration?: number }> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
  const apiKey    = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;

  const timestamp  = Math.floor(Date.now() / 1000).toString();
  const baseParams = { folder: 'nous', timestamp, ...extraParams };
  const signature  = createCloudinarySignature(baseParams, apiSecret);

  const fd = new FormData();
  fd.append('file',      file);
  fd.append('api_key',   apiKey);
  fd.append('timestamp', timestamp);
  fd.append('folder',    'nous');
  fd.append('signature', signature);
  for (const [k, v] of Object.entries(extraParams)) fd.append(k, v);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    { method: 'POST', body: fd },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Cloudinary upload failed');
  return data;
}

async function deleteFromCloudinary(publicId: string, resourceType: 'image' | 'video') {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const str       = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash('sha1').update(str).digest('hex');

  const fd = new FormData();
  fd.append('public_id', publicId);
  fd.append('api_key',   apiKey);
  fd.append('timestamp', timestamp);
  fd.append('signature', signature);

  await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    { method: 'POST', body: fd },
  ).catch((err) => console.error('Cloudinary delete error:', err));
}

// ── GET /api/stories ──────────────────────────────────────────────────────────

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('stories')
      .select(`
        id, user_id,
        image_url, image_public_id,
        video_url, video_public_id,
        media_type, caption,
        youtube_url, youtube_video_id, youtube_title,
        youtube_start_sec, youtube_end_sec,
        created_at, expires_at
      `)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((s) => s.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .in('id', userIds);

    const usersMap = Object.fromEntries(
      (users ?? []).map((u) => {
        const decrypted = decryptFields(u as Record<string, unknown>, ['name', 'avatar_url']);
        return [u.id, decrypted];
      })
    );

    const stories = (data ?? []).map((story) => ({
      ...story,
      author: usersMap[story.user_id] ?? { id: story.user_id, name: 'Unknown', avatar_url: null },
    }));

    return NextResponse.json(stories);
  } catch (err) {
    console.error('Get stories error:', err);
    return NextResponse.json({ error: 'Failed to fetch stories' }, { status: 500 });
  }
}

// ── POST /api/stories ─────────────────────────────────────────────────────────
// Accepts multipart/form-data with file uploads, handles Cloudinary upload
// with portrait crop (ar_9:16,c_fill) baked in — story-specific transformation.

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    const apiKey    = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'Cloudinary server credentials are missing' },
        { status: 500 },
      );
    }

    const formData       = await request.formData();
    const imageFile      = formData.get('image_file');
    const videoFile      = formData.get('video_file');
    const startOffsetRaw = formData.get('startOffset');
    const startOffset    = startOffsetRaw ? parseFloat(startOffsetRaw as string) : 0;
    const isSelfie       = formData.get('isSelfie') === 'true';
    const captionRaw     = formData.get('caption') as string | null;
    const caption        = sanitizeText(captionRaw) || null;

    // YouTube fields (optional)
    const youtubeVideoIdRaw = formData.get('youtube_video_id') as string | null;
    const youtubeVideoId = validateYouTubeId(youtubeVideoIdRaw);
    const youtubeTitleRaw   = formData.get('youtube_title') as string | null;
    const youtubeTitle      = sanitizeText(youtubeTitleRaw);
    const youtubeStartSec = formData.get('youtube_start_sec');
    const youtubeEndSec   = formData.get('youtube_end_sec');

    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: 'image_file is required' }, { status: 400 });
    }

    // Validate image MIME type and size
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedImageTypes.includes(imageFile.type)) {
      return NextResponse.json({ error: 'Unsupported image format' }, { status: 400 });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Image must be smaller than 5MB' }, { status: 400 });
    }

    // ── Upload image (with portrait crop) ─────────────────────────────────────
    const imgResult  = await uploadToCloudinary(imageFile, 'image');
    const imageUrl   = applyImageTransformations(imgResult.secure_url, isSelfie);
    const imagePublicId = imgResult.public_id;

    // ── Upload video (optional) ───────────────────────────────────────────────
    let videoUrl: string | null = null;
    let videoPublicId: string | null = null;

    if (videoFile instanceof File) {
      const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
      if (!allowedVideoTypes.includes(videoFile.type)) {
        return NextResponse.json({ error: 'Unsupported video format' }, { status: 400 });
      }

      if (videoFile.size > MAX_VIDEO_SIZE) {
        return NextResponse.json({ error: 'Video must be smaller than 50MB' }, { status: 400 });
      }
      const endOffset   = startOffset + MAX_VIDEO_DURATION;
      const videoResult = await uploadToCloudinary(videoFile, 'video', {
        transformation: `so_${startOffset.toFixed(1)},eo_${endOffset.toFixed(1)}`,
      });
      videoUrl      = applyVideoTransformations(videoResult.secure_url);
      videoPublicId = videoResult.public_id;
    }

    // ── Insert into DB ────────────────────────────────────────────────────────
    const { data, error } = await supabase
      .from('stories')
      .insert({
        user_id:           session.userId,
        image_url:         imageUrl,
        image_public_id:   imagePublicId,
        video_url:         videoUrl,
        video_public_id:   videoPublicId,
        media_type:        videoUrl ? 'video' : 'image',
        caption,
        youtube_url:       null,
        youtube_video_id:  youtubeVideoId ?? null,
        youtube_title:     youtubeTitle,
        youtube_start_sec: youtubeStartSec ? parseFloat(youtubeStartSec as string) : null,
        youtube_end_sec:   youtubeEndSec   ? parseFloat(youtubeEndSec   as string) : null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('Create story error:', err);
    return NextResponse.json({ error: 'Failed to create story' }, { status: 500 });
  }
}

// ── DELETE /api/stories?id=<id> ───────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const { data: story, error: fetchError } = await supabase
      .from('stories')
      .select('image_public_id, video_public_id, user_id')
      .eq('id', id)
      .single();

    if (fetchError || !story) {
      return NextResponse.json({ error: 'Story not found' }, { status: 404 });
    }

    if (story.user_id !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabase.from('stories').delete().eq('id', id);
    if (error) throw error;

    if (story.image_public_id) void deleteFromCloudinary(story.image_public_id, 'image');
    if (story.video_public_id) void deleteFromCloudinary(story.video_public_id, 'video');

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete story error:', err);
    return NextResponse.json({ error: 'Failed to delete story' }, { status: 500 });
  }
}