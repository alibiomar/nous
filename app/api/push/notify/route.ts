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
// Body: { message: string }
// Sends push notification to all OTHER users' subscribed devices
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message } = await req.json() as { message: string };
    if (!message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Get all subscriptions that don't belong to the current user
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .neq('user_id', session.userId);

    if (error) throw error;
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const payload = JSON.stringify({
      body: message,
      url: '/cinema',
    });

    // Send to all subscriptions, collect expired ones to clean up
    const expiredEndpoints: string[] = [];

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload
          );
        } catch (err: unknown) {
          // 410 Gone = subscription expired/unregistered — clean it up
          if (
            err &&
            typeof err === 'object' &&
            'statusCode' in err &&
            (err.statusCode === 410 || err.statusCode === 404)
          ) {
            expiredEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints);
    }

    return NextResponse.json({ ok: true, sent: subscriptions.length - expiredEndpoints.length });
  } catch (err) {
    console.error('Push notify error:', err);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}