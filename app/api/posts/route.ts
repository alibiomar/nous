import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { feedPostsCacheKey, invalidateFeedPostsCache } from '@/lib/api-cache';
import { decryptFields, encryptFields, encryptValue } from '@/lib/db-encryption';
import { getOrSetCache } from '@/lib/server-cache';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

function encryptUserProfileFields<T extends Record<string, unknown>>(user: T) {
  return encryptFields(user, ['name', 'avatar_url'] as (keyof T)[]);
}

function decryptUserProfileFields<T extends Record<string, unknown>>(user: T) {
  return decryptFields(user, ['name', 'avatar_url'] as (keyof T)[]);
}

function decryptPostRecord(post: Record<string, unknown>) {
  const decryptedPost = decryptFields(post, ['caption', 'image_url']);
  const user = decryptedPost.user;

  if (user && typeof user === 'object' && !Array.isArray(user)) {
    decryptedPost.user = decryptUserProfileFields(user as Record<string, unknown>);
  }

  return decryptedPost;
}

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

export async function GET(request: NextRequest) {
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

    const { supabase, error: authError } = await createAuthedClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cacheKey = feedPostsCacheKey(session.userId);

    const decryptedPosts = await getOrSetCache(cacheKey, 15_000, async () => {
      // Cache the personalized feed briefly to reduce repeated DB reads.
      const { data: posts, error } = await supabase
        .from('posts')
        .select(
          `
          *,
          user:users(id, name, email, avatar_url),
          likes(count),
          comments(count)
        `
        )
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      const postIds = (posts || []).map((post) => post.id);
      let likedPostIds = new Set<string>();

      if (postIds.length > 0) {
        const { data: userLikes, error: likesError } = await supabase
          .from('likes')
          .select('post_id')
          .eq('user_id', session.userId)
          .in('post_id', postIds);

        if (likesError) {
          throw likesError;
        }

        likedPostIds = new Set((userLikes || []).map((like) => like.post_id));
      }

      const postsWithLikeState = (posts || []).map((post) => ({
        ...post,
        liked_by_me: likedPostIds.has(post.id),
      }));

      return postsWithLikeState.map((post) =>
        decryptPostRecord(post as Record<string, unknown>)
      );
    });

    return NextResponse.json(decryptedPosts);
  } catch (error) {
    console.error('Get posts error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

    const { supabase, error: authError } = await createAuthedClient();
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { caption, image_url } = body;

    if (!image_url) {
      return NextResponse.json(
        { error: 'Image URL is required' },
        { status: 400 }
      );
    }

    const { error: upsertError } = await supabase
      .from('users')
      .upsert(
        [
          encryptUserProfileFields({
            id: session.userId,
            email: session.email,
            name: session.name,
            avatar_url: session.avatarUrl,
          }),
        ],
        { onConflict: 'id' }
      );

    if (upsertError && supabaseAdmin) {
      await supabaseAdmin
        .from('users')
        .upsert(
          encryptUserProfileFields({
            id: session.userId,
            email: session.email,
            name: session.name,
            avatar_url: session.avatarUrl,
          }),
          { onConflict: 'email' }
        );
    }

    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id: session.userId,
        caption: encryptValue(caption || ''),
        image_url: encryptValue(image_url),
      })
      .select('*, user:users(id, name, email, avatar_url), likes(count), comments(count)')
      .single();

    if (error) {
      throw error;
    }

    invalidateFeedPostsCache();

    return NextResponse.json(
      decryptPostRecord(post as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Create post error:', error);
    return NextResponse.json(
      { error: 'Failed to create post' },
      { status: 500 }
    );
  }
}
