import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  // 1. Create a baseline response that we can modify with new cookies if needed
  let supabaseResponse = NextResponse.next({
    request,
  });

  // 2. Create the Supabase SSR client for Middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // If Supabase needs to refresh the token, it will call this method.
          
          // Update the request cookies so Server Components see the new token
          cookiesToSet.forEach(({ name, value, options }) => 
            request.cookies.set(name, value)
          );
          
          // Re-create the response to ensure headers are fresh
          supabaseResponse = NextResponse.next({
            request,
          });
          
          // Update the response cookies so the browser saves the new token
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 3. Securely verify the session. 
  // If the token is expired, this automatically triggers the `setAll` block above!
  const { data: { user } } = await supabase.auth.getUser();

  const isPublicRoute = request.nextUrl.pathname === '/login';

  // 4. Redirect unauthenticated users
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // 5. Redirect authenticated users away from the login page
  if (user && isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/feed';
    return NextResponse.redirect(url);
  }

  // 6. Return the response (which contains any refreshed cookies!)
  // Set a conservative Content Security Policy to mitigate XSS impact.
  // Adjust sources as needed for third-party integrations (YouTube, Cloudinary, analytics).
  const isProd = process.env.NODE_ENV === 'production';
const prodCsp = [
  "default-src 'self'",

  // YouTube IFrame API injects inline scripts — 'unsafe-inline' is required.
  // s.ytimg.com serves YouTube's player assets.
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com https://www.youtube.com https://s.ytimg.com",

  "connect-src 'self' https://api.cloudinary.com https://*.supabase.co https://*.peerjs.com wss:",

  "img-src 'self' data: blob: https://res.cloudinary.com",

  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  "font-src 'self' data: https://fonts.gstatic.com",

  "frame-src 'self' https://www.youtube.com https://tuniflix.site/",

  "object-src 'none'",

  // extra hardening (recommended)
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
  // During development, relax CSP to avoid blocking dev tooling (HMR/react-refresh uses eval/inline).
  // In production, keep the stricter policy above.
const devCsp = [
  "default-src 'self'",

  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://www.youtube.com https://s.ytimg.com",

  "connect-src 'self' https://api.cloudinary.com https://*.supabase.co https://*.peerjs.com wss:",

  "img-src 'self' data: blob: https://res.cloudinary.com",

  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  "font-src 'self' data: https://fonts.gstatic.com",

  "frame-src 'self' https://www.youtube.com https://tuniflix.site/" ,

  "object-src 'none'",
].join('; ');
  const csp = isProd ? prodCsp : devCsp;

  supabaseResponse.headers.set('Content-Security-Policy', csp);

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon.svg|apple-icon.png|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};