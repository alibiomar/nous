import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { decryptFields, encryptValue } from '@/lib/db-encryption';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function normalizePlatform(platform: string | undefined) {
  const value = platform?.toLowerCase();

  if (value === 'spotify' || value === 'youtube') {
    return value;
  }

  return 'unknown';
}

function decryptMusicRecord(music: Record<string, unknown>) {
  const decryptedMusic = decryptFields(music, ['url', 'title']);
  const addedBy = decryptedMusic.added_by;

  if (addedBy && typeof addedBy === 'object' && !Array.isArray(addedBy)) {
    decryptedMusic.added_by = decryptFields(
      addedBy as Record<string, unknown>,
      ['name']
    );
  }

  return decryptedMusic;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: music, error } = await supabase
      .from('music')
      .select('*, added_by:users(id, name)')
      .eq('now_playing', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      music ? decryptMusicRecord(music as Record<string, unknown>) : null
    );
  } catch (error) {
    console.error('Get music error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch music' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { url, title, platform } = body;

    if (!url || !title) {
      return NextResponse.json(
        { error: 'URL and title are required' },
        { status: 400 }
      );
    }

    const normalizedPlatform = normalizePlatform(platform);

    const { error: clearError } = await supabase
      .from('music')
      .update({ now_playing: false })
      .eq('now_playing', true);

    if (clearError) {
      throw clearError;
    }

    const { data: music, error } = await supabase
      .from('music')
      .insert({
        added_by: session.userId,
        url: encryptValue(url),
        title: encryptValue(title),
        platform: normalizedPlatform,
        now_playing: true,
      })
      .select('*, added_by:users(id, name)')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      decryptMusicRecord(music as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Add music error:', error);
    return NextResponse.json(
      { error: 'Failed to add music' },
      { status: 500 }
    );
  }
}
