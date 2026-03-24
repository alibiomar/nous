import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Define routes that do NOT require authentication
  const isPublicRoute = pathname === '/login';

  // 2. Get the access token from cookies
  const accessToken = request.cookies.get('sb-access-token')?.value;

  let isAuthValid = false;

  // 3. HIGH LEVEL SECURITY: Cryptographically verify the token
  if (accessToken) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // getUser() sends the token to the Supabase Auth server.
    // It will fail if the token is fake, expired, or if the user was banned/deleted.
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (!error && data?.user) {
      isAuthValid = true;
    }
  }

  // 4. If the user is NOT cryptographically verified and trying to access a protected route
  if (!isPublicRoute && !isAuthValid) {
    // Clear the invalid cookies so the browser doesn't get stuck in a bad state
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('sb-access-token');
    response.cookies.delete('sb-refresh-token');
    return response;
  }

  // 5. If the user IS verified and tries to go to the login page, push them to the feed
  if (isPublicRoute && isAuthValid && pathname === '/login') {
    return NextResponse.redirect(new URL('/feed', request.url));
  }

  // 6. Token is valid and route is correct, allow the request
  return NextResponse.next();
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files like CSS/JS)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - any public asset files (e.g., .svg, .png, .jpg)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};