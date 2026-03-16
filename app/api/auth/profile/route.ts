import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { encryptFields } from '@/lib/db-encryption';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are missing' },
        { status: 500 }
      );
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        avatarUrl: session.avatarUrl,
        birthday: session.birthday,
      },
    });
  } catch (error) {
    console.error('Profile GET error:', error);
    return NextResponse.json(
      { error: 'Failed to load profile' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase credentials are missing' },
        { status: 500 }
      );
    }

    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const name = cleanString(body?.name);
    const avatarUrl = cleanString(body?.avatar_url ?? body?.avatarUrl);
    const birthday = cleanString(body?.birthday);

    if (!name && !avatarUrl && !birthday) {
      return NextResponse.json({ error: 'No profile updates provided' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value;
    const refreshToken = cookieStore.get('sb-refresh-token')?.value;

    if (!accessToken || !refreshToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (sessionError) {
      console.error('Profile session error:', sessionError);
      return NextResponse.json(
        { error: sessionError.message || 'Failed to load session' },
        { status: 401 }
      );
    }

    const nextMetadata = {
      ...(name ? { name } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      ...(birthday ? { birthday } : {}),
    };

    const { data: updated, error: updateError } = await supabase.auth.updateUser({
      data: nextMetadata,
    });

    if (updateError || !updated?.user) {
      console.error('Profile update error:', updateError);
      return NextResponse.json(
        { error: updateError?.message || 'Failed to update profile' },
        { status: 500 }
      );
    }

    if (name || avatarUrl) {
      const encryptedProfileUpdate = encryptFields(
        {
          ...(name ? { name } : {}),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        },
        ['name', 'avatar_url']
      );

      const { error: profileUpdateError } = await supabase
        .from('users')
        .update(encryptedProfileUpdate)
        .eq('id', session.userId);

      if (profileUpdateError) {
        console.error('Users table update error:', profileUpdateError);
      }
    }

    return NextResponse.json({
      user: {
        id: updated.user.id,
        email: updated.user.email,
        name: name || session.name,
        avatarUrl: avatarUrl || session.avatarUrl,
        birthday: birthday || session.birthday,
      },
    });
  } catch (error) {
    console.error('Profile PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
