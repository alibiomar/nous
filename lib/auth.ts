import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const ACCESS_TOKEN_COOKIE = 'sb-access-token';
const REFRESH_TOKEN_COOKIE = 'sb-refresh-token';

export interface AuthSessionUser {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  birthday: string | null;
}

function getUserName(user: { email?: string | null; user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata || {};
  const name = metadata.name || metadata.full_name;

  if (typeof name === 'string' && name.trim().length > 0) {
    return name;
  }

  return user.email || '';
}

function getUserMetadataFields(user: { user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata || {};
  const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;
  const birthday = typeof metadata.birthday === 'string' ? metadata.birthday : null;

  return { avatarUrl, birthday };
}

export async function getSession(): Promise<AuthSessionUser | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (!accessToken && !refreshToken) return null;

  if (accessToken) {
    const { data, error } = await authClient.auth.getUser(accessToken);
    if (!error && data?.user) {
      const { avatarUrl, birthday } = getUserMetadataFields(data.user);
      return {
        userId: data.user.id,
        email: data.user.email || '',
        name: getUserName(data.user),
        avatarUrl,
        birthday,
      };
    }
  }

  if (!refreshToken) return null;

  const { data: refreshed, error: refreshError } = await authClient.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (refreshError || !refreshed?.session || !refreshed.user) {
    return null;
  }

  await setAuthCookies(refreshed.session.access_token, refreshed.session.refresh_token, refreshed.session.expires_in);

  const { avatarUrl, birthday } = getUserMetadataFields(refreshed.user);
  return {
    userId: refreshed.user.id,
    email: refreshed.user.email || '',
    name: getUserName(refreshed.user),
    avatarUrl,
    birthday,
  };
}

export async function setAuthCookies(
  accessToken: string,
  refreshToken: string,
  expiresInSeconds?: number
): Promise<void> {
  const cookieStore = await cookies();
  const maxAge = expiresInSeconds && expiresInSeconds > 0 ? expiresInSeconds : 60 * 60;

  cookieStore.set(ACCESS_TOKEN_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
  });

  cookieStore.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearAuthCookies(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCESS_TOKEN_COOKIE);
  cookieStore.delete(REFRESH_TOKEN_COOKIE);
}


