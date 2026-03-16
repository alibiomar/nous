import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { invalidateFeedPostsCache } from '@/lib/api-cache';

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

    const { id: postId } = await params;

    // Check if already liked
    const { data: existingLike, error: checkError } = await supabase
      .from('likes')
      .select()
      .eq('post_id', postId)
      .eq('user_id', session.userId)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existingLike) {
      return NextResponse.json(
        { error: 'Already liked' },
        { status: 400 }
      );
    }

    // Add like
    const { error } = await supabase
      .from('likes')
      .insert({
        post_id: postId,
        user_id: session.userId,
      });

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Like error:', error);
    return NextResponse.json(
      { error: 'Failed to like post' },
      { status: 500 }
    );
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

    // Get access token from cookies
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;
    
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    // Create client with user's JWT context
    const supabase = createUserAuthenticatedClient(accessToken);

    const { id: postId } = await params;

    // Remove like
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', session.userId);

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unlike error:', error);
    return NextResponse.json(
      { error: 'Failed to unlike post' },
      { status: 500 }
    );
  }
}
