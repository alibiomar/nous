import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSession } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'cinema@nous.app'}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// POST /api/push/notify
// Body: { message: string, senderId?: string, url?: string }
//
// Two auth modes:
// 1. Client call — authenticated via session cookie (cinema sync buttons)
// 2. Server-to-server — authenticated via X-Internal-Secret header
//    (messages API, call API) — passes senderId explicitly so we know
//    whose subscriptions to exclude
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { message: string; senderId?: string; url?: string };

    if (!body.message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const internalSecret = req.headers.get('x-internal-secret');
    const isInternalCall =
      internalSecret &&
      process.env.INTERNAL_API_SECRET &&
      internalSecret === process.env.INTERNAL_API_SECRET;

    let senderId: string | null = null;

    if (isInternalCall) {
      // Server-to-server: use senderId from body
      senderId = body.senderId ?? null;
    } else {
      // Client call: authenticate via session cookie
      const session = await getSession();
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      senderId = session.userId;
    }

    return await sendPush(body.message, senderId, body.url ?? '/');
  } catch (err) {
    console.error('Push notify error:', err);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}

async function sendPush(message: string, senderId: string | null, url: string) {
  let query = supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth');

  // Exclude sender's own devices
  if (senderId) {
    query = query.neq('user_id', senderId) as typeof query;
  }

  const { data: subscriptions, error } = await query;

  if (error) throw error;
  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({ body: message, url });
  const expiredEndpoints: string[] = [];

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err: unknown) {
        if (
          err && typeof err === 'object' && 'statusCode' in err &&
          (err.statusCode === 410 || err.statusCode === 404)
        ) {
          expiredEndpoints.push(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.length > 0) {
    await supabase.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return NextResponse.json({
    ok: true,
    sent: subscriptions.length - expiredEndpoints.length,
  });
}