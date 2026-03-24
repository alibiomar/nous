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
  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon.svg|apple-icon.png|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};