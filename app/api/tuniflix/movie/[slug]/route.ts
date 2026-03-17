import { NextResponse } from 'next/server';
import { getMovie } from '../../../../../lib/tuniflix';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    if (!slug?.trim()) {
      return NextResponse.json(
        { error: 'Missing movie slug' },
        { status: 400 }
      );
    }

    const data = await getMovie(slug);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Tuniflix movie error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch movie data' },
      { status: 500 }
    );
  }
}
