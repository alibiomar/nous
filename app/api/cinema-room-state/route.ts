import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession, createClient } from '@/lib/auth';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// How many votes are needed to clear the room
const VOTES_REQUIRED = 2;

async function createRoomClient(): Promise<{
  supabase: SupabaseClient;
  authError: string | null;
}> {
  if (supabaseServiceRoleKey) {
    return {
      supabase: createServiceClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      authError: null,
    };
  }

  const supabase = await createClient();
  return { supabase, authError: null };
}

// ─── GET — fetch room state + clear vote count ────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const room = request.nextUrl.searchParams.get('room') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Supabase credentials are missing' }, { status: 500 });
    }

    const { supabase } = await createRoomClient();

    if (!room) return NextResponse.json(null);

    const [roomRes, votesRes] = await Promise.all([
      supabase
        .from('cinema_room_state')
        .select('*')
        .eq('room', room)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('cinema_clear_votes')
        .select('user_id')
        .eq('room', room),
    ]);

    if (roomRes.error) throw roomRes.error;

    return NextResponse.json({
      ...(roomRes.data ?? null),
      // Attach vote info so the client can show "1/2"
      clearVotes: votesRes.data?.length ?? 0,
      votesRequired: VOTES_REQUIRED,
    });
  } catch (error) {
    console.error('Get cinema room state error:', error);
    return NextResponse.json({ error: 'Failed to fetch room state' }, { status: 500 });
  }
}

// ─── POST — upsert room state, incrementing version on every write ─────────────
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { room, room_type, payload } = body;

    if (!room) {
      return NextResponse.json({ error: 'Room is required' }, { status: 400 });
    }

    // Read current version so we can increment it atomically
    const { data: existing } = await supabase
      .from('cinema_room_state')
      .select('version')
      .eq('room', room)
      .maybeSingle();

    const nextVersion = (existing?.version ?? 0) + 1;

    const upsertData = {
      room,
      room_type: room_type ?? null,
      payload: payload ?? null,
      updated_by: session.userId,
      updated_at: new Date().toISOString(),
      version: nextVersion,
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

// ─── DELETE — vote to clear; only clears when VOTES_REQUIRED unique users vote ─
export async function DELETE(request: NextRequest) {
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const urlRoom = request.nextUrl.searchParams.get('room') ?? undefined;
    let room = urlRoom;
    if (!room) {
      try {
        const body = await request.json();
        room = body?.room;
      } catch {
        // ignore parse errors
      }
    }

    if (!room) {
      return NextResponse.json({ error: 'Room is required' }, { status: 400 });
    }

    // Record this user's vote (upsert so double-clicking is safe)
    const { error: voteError } = await supabase
      .from('cinema_clear_votes')
      .upsert(
        { room, user_id: session.userId, voted_at: new Date().toISOString() },
        { onConflict: 'room,user_id' }
      );

    if (voteError) throw voteError;

    // Count total votes for this room
    const { data: votes, error: countError } = await supabase
      .from('cinema_clear_votes')
      .select('user_id')
      .eq('room', room);

    if (countError) throw countError;

    const voteCount = votes?.length ?? 0;

    if (voteCount >= VOTES_REQUIRED) {
      // Quorum reached — clear room state and all votes
      await Promise.all([
        supabase.from('cinema_room_state').delete().eq('room', room),
        supabase.from('cinema_clear_votes').delete().eq('room', room),
      ]);

      return NextResponse.json({ ok: true, cleared: true, votes: 0, votesRequired: VOTES_REQUIRED });
    }

    // Not enough votes yet — return current count so UI can show "1/2"
    return NextResponse.json({
      ok: true,
      cleared: false,
      votes: voteCount,
      votesRequired: VOTES_REQUIRED,
    });
  } catch (error) {
    console.error('Clear cinema room state error:', error);
    return NextResponse.json({ error: 'Failed to clear room state' }, { status: 500 });
  }
}