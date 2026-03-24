import { NextRequest, NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Using cookie-backed server client from `lib/auth`

export async function PUT(request: NextRequest) {
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

    const supabase = await createClient();

    // Mark all unread messages as read for the current user
    const { error } = await supabase
      .from('messages')
      .update({ read: true })
      .eq('recipient_id', session.userId)
      .eq('read', false);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Mark messages as read error:', error);
    return NextResponse.json(
      { error: 'Failed to mark messages as read' },
      { status: 500 }
    );
  }
}
