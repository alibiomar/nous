import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { invalidateFeedPostsCache } from '@/lib/api-cache';
import { decryptFields, encryptValue } from '@/lib/db-encryption';

function createUserAuthenticatedClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
}

function decryptCommentRecord(comment: Record<string, unknown>) {
  const decryptedComment = decryptFields(comment, ['content']);
  const user = decryptedComment.user;

  if (user && typeof user === 'object' && !Array.isArray(user)) {
    decryptedComment.user = decryptFields(
      user as Record<string, unknown>,
      ['name', 'avatar_url']
    );
  }

  return decryptedComment;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const { commentId } = await params;
    const body = await request.json();
    const content = typeof body?.content === 'string' ? body.content.trim() : '';

    if (!content) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }

    const supabase = createUserAuthenticatedClient(accessToken);

    const { data: updatedComment, error } = await supabase
      .from('comments')
      .update({ content: encryptValue(content) })
      .eq('id', commentId)
      .eq('user_id', session.userId)
      .select('*, user:users(id, name, email, avatar_url)')
      .single();

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

    return NextResponse.json(
      decryptCommentRecord(updatedComment as Record<string, unknown>)
    );
  } catch (error) {
    console.error('Update comment error:', error);
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;

    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const { commentId } = await params;
    const supabase = createUserAuthenticatedClient(accessToken);

    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', session.userId);

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
