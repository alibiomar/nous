import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { getSession } from '@/lib/auth';
import { sanitizeText, validateUrl } from '@/lib/sanitize';
import { createClient as createServiceClient } from '@supabase/supabase-js';

const supabase = createServiceClient(
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

    const safeMessage = sanitizeText(body.message, 300);
    if (!safeMessage) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const internalSecret = req.headers.get('x-internal-secret');
    const isInternalCall =
      internalSecret &&
      process.env.INTERNAL_API_SECRET &&
      internalSecret === process.env.INTERNAL_API_SECRET;

    let senderId: string | null = null;

    if (isInternalCall) {
      // Server-to-server: allow explicit senderId and optional target list
      senderId = typeof body.senderId === 'string' ? body.senderId : null;
      const safeUrl = validateUrl(body.url) ?? '/';
      // support targeted list from internal callers
      const targetUserIds = Array.isArray((body as any).targetUserIds)
        ? (body as any).targetUserIds.filter((id: any) => typeof id === 'string' && /^[\w-]{1,64}$/.test(id))
        : undefined;

      if (targetUserIds && targetUserIds.length > 0) {
        return await sendPush(safeMessage, senderId, safeUrl, targetUserIds);
      }

      return await sendPush(safeMessage, senderId, safeUrl);
    }

    // Client call: authenticate via session cookie and require targeted recipient
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    senderId = session.userId;

    // For client-originated requests we require an explicit recipientId and verify
    // that the sender and recipient have an existing conversation (prevents client
    // from broadcasting to arbitrary users).
    const recipientId = (body as any).recipientId as string | undefined;
    if (!recipientId) {
      return NextResponse.json(
        { error: 'recipientId is required for client-initiated notifications' },
        { status: 400 }
      );
    }

    // Basic recipient id validation
    if (!/^[\w-]{1,64}$/.test(recipientId)) {
      return NextResponse.json({ error: 'Invalid recipientId' }, { status: 400 });
    }

    // Verify that a conversation exists between sender and recipient
    const { data: convo, error: convoError } = await supabase
      .from('messages')
      .select('id')
      .or(
        `(sender_id.eq.${senderId}&recipient_id.eq.${recipientId}),(sender_id.eq.${recipientId}&recipient_id.eq.${senderId})`
      )
      .limit(1);

    if (convoError) {
      throw convoError;
    }

    if (!convo || convo.length === 0) {
      return NextResponse.json({ error: 'Not authorized to notify this user' }, { status: 403 });
    }

    const safeUrl = validateUrl(body.url) ?? '/';
    return await sendPush(safeMessage, senderId, safeUrl, recipientId);
  } catch (err) {
    console.error('Push notify error:', err);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}

async function sendPush(
  message: string,
  senderId: string | null,
  url: string,
  targetUserId?: string | string[]
) {
  // Build subscriptions query depending on whether we target specific users
  let subscriptionsQuery: any = supabase.from('push_subscriptions').select('endpoint, p256dh, auth, user_id');

  if (Array.isArray(targetUserId)) {
    // targetUserId is an array of user ids
    subscriptionsQuery = subscriptionsQuery.in('user_id', targetUserId as string[]);
  } else if (typeof targetUserId === 'string') {
    subscriptionsQuery = subscriptionsQuery.eq('user_id', targetUserId);
  } else {
    // broadcast: exclude sender devices when senderId provided
    if (senderId) subscriptionsQuery = subscriptionsQuery.neq('user_id', senderId);
  }

  const { data: subscriptions, error } = await subscriptionsQuery;

  if (error) throw error;
  if (!subscriptions || subscriptions.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const payload = JSON.stringify({ body: message, url });
  const expiredEndpoints: string[] = [];

  await Promise.allSettled(
    (subscriptions as any[]).map(async (sub) => {
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