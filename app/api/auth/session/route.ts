import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    // getSession() automatically reads the cookies and securely 
    // verifies the user using the new @supabase/ssr architecture!
    const sessionUser = await getSession();

    if (!sessionUser) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    // Return the user data formatted exactly how the client `User` shape expects it
    // (map `userId` -> `id`) so client code like `user?.id` works.
    const clientUser = {
      id: sessionUser.userId,
      email: sessionUser.email,
      name: sessionUser.name,
      avatarUrl: sessionUser.avatarUrl,
      birthday: sessionUser.birthday,
    };

    return NextResponse.json({ user: clientUser }, { status: 200 });
    
  } catch (error) {
    console.error('Session Route Error:', error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}