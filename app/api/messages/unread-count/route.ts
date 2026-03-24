import { NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Use cookie-backed server client from lib/auth

export async function GET() {
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

    const { count, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', session.userId)
      .eq('read', false);

    if (error) {
      throw error;
    }

    const unreadCount = count ?? 0;
    return NextResponse.json({ unreadCount, hasUnread: unreadCount > 0 });
  } catch (error) {
    console.error('Unread count error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch unread count' },
      { status: 500 }
    );
  }
}
