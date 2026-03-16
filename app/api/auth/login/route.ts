import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { setAuthCookies } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data?.session || !data.user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    await setAuthCookies(
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in
    );

    const metadata = data.user.user_metadata || {};
    const name =
      (typeof metadata.name === 'string' && metadata.name) ||
      (typeof metadata.full_name === 'string' && metadata.full_name) ||
      data.user.email ||
      '';
    const avatarUrl =
      typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;
    const birthday =
      typeof metadata.birthday === 'string' ? metadata.birthday : null;

    return NextResponse.json({
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        name,
        avatarUrl,
        birthday,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
