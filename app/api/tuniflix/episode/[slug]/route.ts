import { NextResponse } from 'next/server';
import { getEpisode } from '../../../../../lib/tuniflix';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    if (!slug?.trim()) {
      return NextResponse.json(
        { error: 'Missing episode slug' },
        { status: 400 }
      );
    }

    const data = await getEpisode(slug);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Tuniflix episode error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch episode data' },
      { status: 500 }
    );
  }
}
