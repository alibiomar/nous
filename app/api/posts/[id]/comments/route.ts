import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { invalidateFeedPostsCache } from '@/lib/api-cache';
import { decryptFields, encryptValue } from '@/lib/db-encryption';

// Create client that will use user's JWT for auth context
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get access token from cookies - not required for reading public data
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;
    
    const supabase = accessToken 
      ? createUserAuthenticatedClient(accessToken)
      : createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || '',
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
        );

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

    // Get access token from cookies
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;
    
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    // Create client with user's JWT context
    const supabase = createUserAuthenticatedClient(accessToken);

    const { content } = await request.json();

    if (!content || !content.trim()) {
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
        content: encryptValue(content.trim()),
      })
      .select('*, user:users(id, name, email, avatar_url)')
      .single();

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

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
