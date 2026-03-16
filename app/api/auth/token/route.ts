import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('sb-access-token')?.value || null;
    const refreshToken = cookieStore.get('sb-refresh-token')?.value || null;



    if (!accessToken || !refreshToken) {
      console.warn('⚠️ Token endpoint: Missing auth tokens in cookies');
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({ accessToken, refreshToken });
  } catch (error) {
    console.error('❌ Token endpoint error:', error);
    return NextResponse.json(
      { error: 'Failed to get tokens' },
      { status: 500 }
    );
  }
}
