import { NextResponse } from 'next/server';
import { getSeries } from '../../../../../lib/tuniflix';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    if (!slug?.trim()) {
      return NextResponse.json(
        { error: 'Missing series slug' },
        { status: 400 }
      );
    }

    const data = await getSeries(slug);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Tuniflix series error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch series data' },
      { status: 500 }
    );
  }
}
