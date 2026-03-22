import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/auth';
import { decryptFields } from '@/lib/db-encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ── Cloudinary delete helper ──────────────────────────────────────────────────
async function deleteFromCloudinary(publicId: string, resourceType: 'image' | 'video') {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const str = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash('sha1').update(str).digest('hex');

  const fd = new FormData();
  fd.append('public_id', publicId);
  fd.append('api_key', apiKey);
  fd.append('timestamp', timestamp);
  fd.append('signature', signature);

  await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    { method: 'POST', body: fd }
  ).catch((err) => console.error('Cloudinary delete error:', err));
}

// GET /api/stories — fetch all active (non-expired) stories with author info
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

// POST /api/stories — create a new story
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      image_url, image_public_id,
      video_url, video_public_id,
      media_type, caption,
      youtube_url, youtube_video_id, youtube_title,
      youtube_start_sec, youtube_end_sec,
    } = body;

    if (!image_url) {
      return NextResponse.json({ error: 'image_url is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('stories')
      .insert({
        user_id: session.userId,
        image_url,
        image_public_id: image_public_id ?? null,
        video_url: video_url ?? null,
        video_public_id: video_public_id ?? null,
        media_type: media_type ?? 'image',
        caption: caption?.trim() || null,
        youtube_url: youtube_url ?? null,
        youtube_video_id: youtube_video_id ?? null,
        youtube_title: youtube_title?.trim() || null,
        youtube_start_sec: youtube_start_sec ?? null,
        youtube_end_sec: youtube_end_sec ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    // Push notification to partner
    void fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/push/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `${session.name || 'Someone'} posted a new story ✨`,
        url: '/feed',
      }),
    }).catch(() => undefined);

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error('Create story error:', err);
    return NextResponse.json({ error: 'Failed to create story' }, { status: 500 });
  }
}

// DELETE /api/stories?id=<id> — deletes from DB + Cloudinary
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    // Fetch story first to get public_ids for Cloudinary cleanup
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

    // Delete from DB
    const { error } = await supabase
      .from('stories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Delete from Cloudinary — fire and forget, non-blocking
    if (story.image_public_id) {
      void deleteFromCloudinary(story.image_public_id, 'image');
    }
    if (story.video_public_id) {
      void deleteFromCloudinary(story.video_public_id, 'video');
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete story error:', err);
    return NextResponse.json({ error: 'Failed to delete story' }, { status: 500 });
  }
}