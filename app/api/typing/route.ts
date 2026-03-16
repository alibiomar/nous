import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

async function createAuthedClient() {
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

// POST: Update typing status
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { isTyping } = body;

    if (!supabaseAdmin) {
      console.error('❌ Typing POST: No admin client');
      return NextResponse.json(
        { error: 'Service not available' },
        { status: 500 }
      );
    }

    try {
      // Try to upsert to existing table
      const { data, error } = await supabaseAdmin
        .from('typing_status')
        .upsert(
          [
            {
              user_id: session.userId,
              is_typing: isTyping,
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'user_id' }
        )
        .select();

      if (error && error.code === 'PGRST116' || error?.message?.includes('no rows returned')) {
        // Table might not exist, but that's okay - just return success
        return NextResponse.json({ success: true });
      }

      if (error) {
        console.error('❌ Typing status error:', error.message);
        // Don't fail, just log and continue
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ success: true, data });
    } catch (dbError) {
      console.error('❌ Database error:', dbError);
      // Table doesn't exist, but error is not critical
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error('❌ Typing endpoint error:', error);
    // Return success anyway - this is non-critical
    return NextResponse.json(
      { success: true },
      { status: 200 }
    );
  }
}

// GET: Check if partner is typing
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ isTyping: false, lastUpdate: null });
    }

    const { supabase, error: authError } = await createAuthedClient();
    if (authError) {
      return NextResponse.json({ isTyping: false, lastUpdate: null });
    }

    try {
      // Get all users' typing status except current user
      const { data: typingUsers, error } = await supabase
        .from('typing_status')
        .select('user_id, is_typing, updated_at')
        .neq('user_id', session.userId)
        .eq('is_typing', true);


      if (!typingUsers || typingUsers.length === 0) {
        return NextResponse.json({ isTyping: false, lastUpdate: null });
      }

      // Check if the typing status is still fresh (within last 3 seconds)
      const lastUpdate = new Date(typingUsers[0]?.updated_at || 0).getTime();
      const now = Date.now();
      const isStale = now - lastUpdate > 3000;


      return NextResponse.json({
        isTyping: !isStale,
        lastUpdate: typingUsers[0]?.updated_at,
      });
    } catch (dbError) {
      // Table doesn't exist, but that's okay
      return NextResponse.json({ isTyping: false, lastUpdate: null });
    }
  } catch (error) {
    console.error('❌ Get typing status error:', error);
    return NextResponse.json(
      { isTyping: false, lastUpdate: null },
      { status: 200 }
    );
  }
}
