import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/auth';
import { validateEmail } from '@/lib/sanitize';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = validateEmail(body?.email);
    const password = body?.password;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // 1. Initialize the new SSR client (this handles the cookies automatically!)
    const supabase = await createClient();

    // 2. Sign in with password
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

    // 3. Format the user object exactly as your frontend expects it
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

    // 4. Return success! (Notice: No need to call setAuthCookies anymore)
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
    console.error('Login Route Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}