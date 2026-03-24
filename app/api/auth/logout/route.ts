import { NextResponse } from 'next/server';
import { createClient } from '@/lib/auth';

export async function POST() {
  try {
    // 1. Initialize the new SSR client.
    // This automatically reads the cookies from the incoming request.
    const supabase = await createClient();

    // 2. Sign out.
    // This tells Supabase to invalidate the session on the server AND
    // automatically clears the auth cookies from the browser!
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Logout warning:', error.message);
      // We still proceed even if there's an error (like an already expired session)
      // to ensure the user is safely disconnected on the frontend.
    }

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });

    // Ensure the browser doesn't cache the logout response
    response.headers.set('Cache-Control', 'no-store');

    return response;
  } catch (error) {
    console.error('Logout Route Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}