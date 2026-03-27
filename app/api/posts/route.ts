import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptFields, encryptValue } from '@/lib/db-encryption';
import { sanitizeText, validateUrl } from '@/lib/sanitize';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = supabaseServiceRoleKey
  ? createServiceClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    const { data: posts, error } = await supabase
      .from('posts')
      .select('*, user:users(id, name, email, avatar_url), likes(count), comments(count)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const postIds = (posts || []).map((post) => post.id);
    let likedPostIds = new Set<string>();

    if (postIds.length > 0) {
      const { data: userLikes, error: likesError } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', session.userId)
        .in('post_id', postIds);

      if (likesError) throw likesError;
      likedPostIds = new Set((userLikes || []).map((like) => like.post_id));
    }

    const decryptedPosts = (posts || [])
      .map((post) => ({ ...post, liked_by_me: likedPostIds.has(post.id) }))
      .map((post) => decryptPostRecord(post as Record<string, unknown>));

    return NextResponse.json(decryptedPosts);
  } catch (error) {
    console.error('Get posts error:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    const body = await request.json();
    const { caption: rawCaption, image_url: rawImageUrl } = body;
    const caption = sanitizeText(rawCaption) || '';
    const image_url = validateUrl(rawImageUrl);

    if (!image_url) {
      return NextResponse.json({ error: 'Image URL is required' }, { status: 400 });
    }

    const { error: upsertError } = await supabase
      .from('users')
      .upsert(
        [encryptUserProfileFields({
          id: session.userId,
          email: session.email,
          name: session.name,
          avatar_url: session.avatarUrl,
        })],
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

    if (error) throw error;

    return NextResponse.json(decryptPostRecord(post as Record<string, unknown>), { status: 201 });
  } catch (error) {
    console.error('Create post error:', error);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}