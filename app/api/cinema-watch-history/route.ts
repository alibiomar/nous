import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

function getAdminClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey || supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── GET /api/cinema-watch-history?series=<slug> ──────────────────────────────
// Returns the full watch history for the current user for a given series.
// Each episode appears at most once; re-watching updates watched_at.
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const seriesSlug = request.nextUrl.searchParams.get('series');
    if (!seriesSlug) {
      return NextResponse.json({ error: 'series param is required' }, { status: 400 });
    }

    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from('cinema_watch_history')
      .select('episode_slug, episode_title, episode_number, watched_at')
      .eq('user_id', session.userId)
      .eq('series_slug', seriesSlug)
      .order('watched_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    console.error('Get watch history error:', error);
    return NextResponse.json({ error: 'Failed to fetch watch history' }, { status: 500 });
  }
}

// ─── POST /api/cinema-watch-history ──────────────────────────────────────────
// Records (or updates) a watched episode for the current user.
// Body: { series_slug, episode_slug, episode_title, episode_number }
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { series_slug, episode_slug, episode_title, episode_number } = body;

    if (!series_slug || !episode_slug) {
      return NextResponse.json(
        { error: 'series_slug and episode_slug are required' },
        { status: 400 }
      );
    }

    const supabase = getAdminClient();

    const { data, error } = await supabase
      .from('cinema_watch_history')
      .upsert(
        {
          user_id: session.userId,
          series_slug,
          episode_slug,
          episode_title: episode_title ?? '',
          episode_number: episode_number ?? 0,
          watched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,series_slug,episode_slug' }
      )
      .select('*')
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Post watch history error:', error);
    return NextResponse.json({ error: 'Failed to record watch history' }, { status: 500 });
  }
}