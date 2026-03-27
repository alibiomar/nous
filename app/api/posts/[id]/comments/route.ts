import { NextRequest, NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptValue } from '@/lib/db-encryption';
import { sanitizeText } from '@/lib/sanitize';

// Create client that will use user's JWT for auth context

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Use cookie-backed server client (will be authenticated if cookie present)
    const supabase = await createClient();

    const { id: postId } = await params;

    const { data: comments, error } = await supabase
      .from('comments')
      .select('*, user:users(id, name, email, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const decryptedComments = (comments || []).map((comment) =>
      decryptCommentRecord(comment as Record<string, unknown>)
    );

    return NextResponse.json(decryptedComments);
  } catch (error) {
    console.error('Fetch comments error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    const body = await request.json();
    const content = sanitizeText(body?.content);

    if (!content) {
      return NextResponse.json(
        { error: 'Comment content is required' },
        { status: 400 }
      );
    }

    const { id: postId } = await params;

    const { data: comment, error } = await supabase
      .from('comments')
      .insert({
        post_id: postId,
        user_id: session.userId,
        content: encryptValue(content),
      })
      .select('*, user:users(id, name, email, avatar_url)')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      decryptCommentRecord(comment as Record<string, unknown>)
    );
  } catch (error) {
    console.error('Create comment error:', error);
    return NextResponse.json(
      { error: 'Failed to create comment' },
      { status: 500 }
    );
  }
}
