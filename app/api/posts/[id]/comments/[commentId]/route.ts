import { NextRequest, NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptValue } from '@/lib/db-encryption';
import { sanitizeText } from '@/lib/sanitize';



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

    const { commentId } = await params;
    const body = await request.json();
    const content = sanitizeText(body?.content);

    if (!content) {
      return NextResponse.json({ error: 'Comment content is required' }, { status: 400 });
    }

    const supabase = await createClient();

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

    const { commentId } = await params;
    const supabase = await createClient();

    const { error } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId)
      .eq('user_id', session.userId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
