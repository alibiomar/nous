import { NextRequest, NextResponse } from 'next/server';
import { searchTuniflix } from '../../../../lib/tuniflix';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';

    if (!query) {
      return NextResponse.json(
        { error: 'Missing query parameter: q' },
        { status: 400 }
      );
    }

    const results = await searchTuniflix(query);
    return NextResponse.json(results);
  } catch (error) {
    console.error('Tuniflix search error:', error);
    return NextResponse.json(
      { error: 'Failed to search Tuniflix' },
      { status: 500 }
    );
  }
}
