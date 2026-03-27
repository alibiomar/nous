import { NextResponse } from 'next/server';
import { createClient, getSession } from '@/lib/auth';
import { encryptFields } from '@/lib/db-encryption';

function encodeHtmlEntities(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(value: unknown, maxLen = 100) {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Remove any HTML tags
  trimmed = trimmed.replace(/<[^>]*>/g, '');
  if (trimmed.length === 0) return null;
  // Truncate to a reasonable length and HTML-encode to prevent XSS
  if (trimmed.length > maxLen) trimmed = trimmed.slice(0, maxLen);
  return encodeHtmlEntities(trimmed);
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
    const name = sanitizeText(body?.name);
    const avatarUrl = validateUrl(body?.avatar_url ?? body?.avatarUrl);
    const birthday = validateDate(body?.birthday);

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

function validateUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    // limit length to prevent abuse
    if (trimmed.length > 200) return null;
    return trimmed;
  } catch {
    return null;
  }
}

function validateDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}