import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const supabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// POST /api/push/subscribe
// Body: { endpoint, keys: { p256dh, auth } }
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: session.userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
        },
        { onConflict: 'endpoint' }
      );

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}

// DELETE /api/push/subscribe
// Removes subscription for current user's device
export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { endpoint } = await req.json() as { endpoint: string };
    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', session.userId)
      .eq('endpoint', endpoint);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Push unsubscribe error:', err);
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
  }
}