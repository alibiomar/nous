import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

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
  if (typeof name === 'string' && name.trim().length > 0) return name;
  return user.email || '';
}

function getUserMetadataFields(user: { user_metadata?: Record<string, unknown> }) {
  const metadata = user.user_metadata || {};
  const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null;
  const birthday = typeof metadata.birthday === 'string' ? metadata.birthday : null;
  return { avatarUrl, birthday };
}

// Reusable Supabase client for Server Components, Server Actions, and Route Handlers
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Next.js throws an error if you modify cookies inside a Server Component.
            // We safely swallow it here because our Middleware already handled the refresh!
          }
        },
      },
    }
  );
}

// Your clean, modernized getSession function
export async function getSession(): Promise<AuthSessionUser | null> {
  const supabase = await createClient();

  // Simply call getUser(). The SSR client handles the cookies automatically.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    return null;
  }

  const { avatarUrl, birthday } = getUserMetadataFields(data.user);
  
  return {
    userId: data.user.id,
    email: data.user.email || '',
    name: getUserName(data.user),
    avatarUrl,
    birthday,
  };
}