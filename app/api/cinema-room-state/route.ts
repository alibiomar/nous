import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
    auth: { persistSession: false, autoRefreshToken: false },
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

async function createRoomClient(): Promise<{
  supabase: SupabaseClient;
  authError: string | null;
}> {
  if (supabaseServiceRoleKey) {
    return {
      supabase: createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      authError: null,
    };
  }

  const { supabase, error } = await createAuthedClient();
  return { supabase, authError: error };
}

export async function GET(request: NextRequest) {
  try {
    const room = request.nextUrl.searchParams.get('room') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase credentials are missing' }, { status: 500 });
    }

    const { supabase, authError } = await createRoomClient();
    if (authError) {
      // Auth error only prevents writes; reads are allowed with anon key
    }

    if (!room) {
      return NextResponse.json(null);
    }

    const { data, error } = await supabase
      .from('cinema_room_state')
      .select('*')
      .eq('room', room)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json(data ?? null);
  } catch (error) {
    console.error('Get cinema room state error:', error);
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase credentials are missing' }, { status: 500 });
    }

    const { supabase, authError } = await createRoomClient();
    if (authError) {
      // If no service role key available, we still allow authed client for user
      // but if createRoomClient returned an authError it means session couldn't be set.
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { room, room_type, payload } = body;

    if (!room) {
      return NextResponse.json({ error: 'Room is required' }, { status: 400 });
    }

    const upsertData = {
      room,
      room_type: room_type ?? null,
      payload: payload ?? null,
      updated_by: session.userId,
    };

    const { data, error } = await supabase
      .from('cinema_room_state')
      .upsert(upsertData, { onConflict: 'room' })
      .select('*')
      .single();

    if (error) {
      if (error.code === '42501') {
        return NextResponse.json({ error: 'Write blocked by RLS', code: error.code }, { status: 403 });
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Set cinema room state error:', error);
    return NextResponse.json({ error: 'Failed to set room state' }, { status: 500 });
  }
}
