import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { decryptFields, encryptValue } from '@/lib/db-encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

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
    return { supabase, error: 'Not authenticated' } as const;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return { supabase, error: error.message } as const;
  }

  return { supabase, error: null } as const;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const { supabase, error: authError } = await createAuthedClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';

    if (!content) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }

    const { data: message, error } = await supabase
      .from('messages')
      .update({ content: encryptValue(content) })
      .eq('id', id)
      .eq('sender_id', session.userId)
      .select('id, content')
      .single();

    if (error || !message) {
      return NextResponse.json(
        { error: 'Message not found or you cannot edit it' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      decryptFields(message as Record<string, unknown>, ['content'])
    );
  } catch (error) {
    console.error('Update message error:', error);
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const { supabase, error: authError } = await createAuthedClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: deleted, error } = await supabase
      .from('messages')
      .delete()
      .eq('id', id)
      .eq('sender_id', session.userId)
      .select('id')
      .single();

    if (error || !deleted) {
      return NextResponse.json(
        { error: 'Message not found or you cannot delete it' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete message error:', error);
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    );
  }
}
