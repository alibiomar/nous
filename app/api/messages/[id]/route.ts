import { NextRequest, NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptValue } from '@/lib/db-encryption';
import { sanitizeText } from '@/lib/sanitize';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Use the cookie-backed server client from `lib/auth` instead of manual session plumbing

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

    const supabase = await createClient();

    const body = await request.json();
    const content = sanitizeText(body?.content);

    if (!content) {
      return NextResponse.json(
        { error: 'Message content is required' },
        { status: 400 }
      );
    }
    const { data: message, error } = await supabase
      .from('messages')
      .update({ content: encryptValue(content), is_edited: true })
      .eq('id', id)
      .eq('sender_id', session.userId)
      .select('id, content, recipient_id, is_edited')
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

    const supabase = await createClient();

    const { data: deleted, error } = await supabase
      .from('messages')
      .delete()
      .eq('id', id)
      .eq('sender_id', session.userId)
      .select('id, recipient_id')
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
