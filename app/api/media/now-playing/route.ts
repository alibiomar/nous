import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decryptFields, encryptValue } from '@/lib/db-encryption';
import { parseYouTubeUrl, fetchYouTubeTitle } from '@/lib/youtube';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function createAuthedClient(): Promise<{
  supabase: SupabaseClient;
  error: string | null;
}> {
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const cookieStore = await cookies();
  const accessToken = cookieStore.get('sb-access-token')?.value;
  const refreshToken = cookieStore.get('sb-refresh-token')?.value;

  if (!accessToken || !refreshToken) {
    return { supabase, error: 'Not authenticated' };
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return { supabase, error: error.message };
  }

  return { supabase, error: null };
}

async function createMediaClient(): Promise<{
  supabase: SupabaseClient;
  authError: string | null;
}> {
  if (supabaseServiceRoleKey) {
    return {
      supabase: createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }),
      authError: null,
    };
  }

  const { supabase, error } = await createAuthedClient();
  return { supabase, authError: error };
}

function decryptMediaRecord(media: Record<string, unknown>) {
  const decryptedMedia = decryptFields(media, ['url', 'title']);
  const addedBy = decryptedMedia.added_by;

  if (addedBy && typeof addedBy === 'object' && !Array.isArray(addedBy)) {
    decryptedMedia.added_by = decryptFields(
      addedBy as Record<string, unknown>,
      ['name']
    );
  }

  return decryptedMedia;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are missing' },
        { status: 500 }
      );
    }

    const { supabase, authError } = await createMediaClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: media, error } = await supabase
      .from('media')
      .select('*, added_by:users(id, name)')
      .eq('now_playing', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      media ? decryptMediaRecord(media as Record<string, unknown>) : null
    );
  } catch (error) {
    console.error('Get media error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch media' },
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

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are missing' },
        { status: 500 }
      );
    }

    const { supabase, authError } = await createMediaClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    let { url, title } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    const parsedYouTube = parseYouTubeUrl(url);
    if (!parsedYouTube) {
      return NextResponse.json(
        { error: 'Only valid YouTube video or playlist URLs are supported for now' },
        { status: 400 }
      );
    }

    if (!title) {
      title = await fetchYouTubeTitle(url);
    }

    const { error: clearError } = await supabase
      .from('media')
      .update({ now_playing: false })
      .eq('now_playing', true);

    if (clearError) {
      throw clearError;
    }

    const { data: media, error } = await supabase
      .from('media')
      .insert({
        added_by: session.userId,
        url: encryptValue(url),
        title: encryptValue(title),
        platform: 'youtube',
        type: 'video',
        now_playing: true,
      })
      .select('*, added_by:users(id, name)')
      .single();

    if (error) {
      if (error.code === '42501') {
        return NextResponse.json(
          {
            error:
              'Media write blocked by RLS. Run scripts/08-fix-media-rls-shared-playback.sql or configure SUPABASE_SERVICE_ROLE_KEY.',
            code: error.code,
          },
          { status: 403 }
        );
      }

      throw error;
    }

    return NextResponse.json(
      decryptMediaRecord(media as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Add media error:', error);
    return NextResponse.json(
      { error: 'Failed to add media' },
      { status: 500 }
    );
  }
}
