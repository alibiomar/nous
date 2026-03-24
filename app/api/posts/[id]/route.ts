import { NextRequest, NextResponse } from 'next/server';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptValue } from '@/lib/db-encryption';



export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: postId } = await params;
    const body = await request.json();
    const caption = typeof body?.caption === 'string' ? body.caption.trim() : '';

    const supabase = await createClient();

    const { data: updatedPost, error } = await supabase
      .from('posts')
      .update({ caption: encryptValue(caption) })
      .eq('id', postId)
      .eq('user_id', session.userId)
      .select('id, caption')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      decryptFields(updatedPost as Record<string, unknown>, ['caption'])
    );
  } catch (error) {
    console.error('Update post error:', error);
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: postId } = await params;
    const supabase = await createClient();

    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', session.userId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete post error:', error);
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
}
