import { NextResponse } from 'next/server';
import { createClient, getSession } from '@/lib/auth';
import { encryptFields } from '@/lib/db-encryption';

function cleanString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET() {
  try {
    // getSession() now uses the secure SSR client under the hood!
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

    // 1. Initialize the new SSR client.
    // Notice: We don't need to read cookies or call setSession manually anymore!
    const supabase = await createClient();

    const nextMetadata = {
      ...(name ? { name } : {}),
      ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      ...(birthday ? { birthday } : {}),
    };

    // 2. Safely update auth metadata. The client uses the verified secure cookies automatically.
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

    // 3. Update the custom database table securely
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