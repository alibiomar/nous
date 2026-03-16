import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isStaticAsset = /\.[a-zA-Z0-9]+$/.test(pathname);
  if (
    isStaticAsset ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/_vercel') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // Public routes that don't require auth
  const publicRoutes = ['/login', '/'];

  // API routes that don't require auth
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get('sb-access-token')?.value;
  const refreshToken = request.cookies.get('sb-refresh-token')?.value;

  if (!accessToken && !refreshToken) {
    // No token, redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (!error && data?.user) {
      return NextResponse.next();
    }
  }

  if (!refreshToken) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');
    return response;
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (refreshError || !refreshed?.session || !refreshed.user) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');
    return response;
  }

  const response = NextResponse.next();
  response.cookies.set('sb-access-token', refreshed.session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: refreshed.session.expires_in,
  });
  response.cookies.set('sb-refresh-token', refreshed.session.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
