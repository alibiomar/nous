import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSession, createClient } from '@/lib/auth';
import { decryptFields, encryptFields, encryptValue } from '@/lib/db-encryption';
import { sanitizeText, validateUrl } from '@/lib/sanitize';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabaseAdmin = supabaseServiceRoleKey
  ? createServiceClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

function encryptUserProfileFields<T extends Record<string, unknown>>(user: T) {
  return encryptFields(user, ['name', 'avatar_url'] as (keyof T)[]);
}

function decryptUserProfileFields<T extends Record<string, unknown>>(user: T) {
  return decryptFields(user, ['name', 'avatar_url'] as (keyof T)[]);
}

function decryptMessageRecord(message: Record<string, unknown>) {
  const decryptedMessage = decryptFields(message, ['content', 'image_url']);
  const sender = decryptedMessage.sender;

  if (sender && typeof sender === 'object' && !Array.isArray(sender)) {
    decryptedMessage.sender = decryptUserProfileFields(sender as Record<string, unknown>);
  }

  return decryptedMessage;
}

async function ensureUserRow(
  supabase: SupabaseClient,
  session: { userId: string; email: string; name: string; avatarUrl: string | null }
) {
  const { error } = await supabase
    .from('users')
    .upsert(
      [
        encryptUserProfileFields({
          id: session.userId,
          email: session.email,
          name: session.name,
          avatar_url: session.avatarUrl,
        }),
      ],
      { onConflict: 'id' }
    );

  if (!error || !supabaseAdmin) {
    return;
  }

  await supabaseAdmin
    .from('users')
    .upsert(
      encryptUserProfileFields({
        id: session.userId,
        email: session.email,
        name: session.name,
        avatar_url: session.avatarUrl,
      }),
      { onConflict: 'email' }
    );
}

async function getPartnerId(
  supabase: SupabaseClient,
  currentUserId: string
) {
  const { data: partner, error } = await supabase
    .from('users')
    .select('id')
    .neq('id', currentUserId)
    .limit(1)
    .single();

  if (!error && partner?.id && partner.id !== currentUserId) {
    return partner.id as string;
  }

  if (!supabaseAdmin) {
    return null;
  }

  const { data: usersData, error: usersError } =
    await supabaseAdmin.auth.admin.listUsers();

  if (usersError || !usersData?.users?.length) {
    return null;
  }

  const authPartner = usersData.users.find((user) => user.id !== currentUserId);
  if (!authPartner) {
    return null;
  }

  const metadata = authPartner.user_metadata || {};
  const partnerName =
    (typeof metadata.name === 'string' && metadata.name) ||
    (typeof metadata.full_name === 'string' && metadata.full_name) ||
    authPartner.email ||
    'Partner';

  await supabaseAdmin
    .from('users')
    .upsert(
      encryptUserProfileFields({
        id: authPartner.id,
        email: authPartner.email || `user-${authPartner.id}@auth.local`,
        name: partnerName,
        avatar_url:
          typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
      }),
      { onConflict: 'id' }
    );

  return authPartner.id as string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    await ensureUserRow(supabase, session);

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const limitRaw = searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

    let query = supabase
      .from('messages')
      .select('*, sender:users!messages_sender_id_fkey(id, name, email, avatar_url)')
      .or(`sender_id.eq.${session.userId},recipient_id.eq.${session.userId}`)
      .order('created_at', { ascending: true });

    if (before) {
      query = query.lt('created_at', before);
    }

    if (limit) {
      query = query.limit(limit);
    }

    const { data: messages, error } = await query;

    if (error) {
      throw error;
    }

    const decryptedMessages = (messages || []).map((message) =>
      decryptMessageRecord(message as Record<string, unknown>)
    );

    return NextResponse.json(decryptedMessages);
  } catch (error) {
    console.error('Get messages error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    await ensureUserRow(supabase, session);

    const body = await request.json();
    const rawContent = body?.content;
    const rawImageUrl = body?.image_url ?? body?.imageUrl;
    const clientTimestamp = body?.clientTimestamp ?? body?.client_timestamp ?? null;
    const content = sanitizeText(rawContent);
    const finalImageUrl = validateUrl(rawImageUrl) || null;

    if (!content && !finalImageUrl) {
      return NextResponse.json(
        { error: 'Content or image is required' },
        { status: 400 }
      );
    }

    const recipientId = await getPartnerId(supabase, session.userId);
    if (!recipientId || recipientId === session.userId) {
      return NextResponse.json(
        { error: 'No chat partner found' },
        { status: 400 }
      );
    }

    const safeTimestamp = clientTimestamp ? new Date(clientTimestamp).toISOString() : new Date().toISOString();

    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        sender_id: session.userId,
        recipient_id: recipientId,
        content: encryptValue(content || null),
        image_url: encryptValue(finalImageUrl),
        read: false,
        created_at: safeTimestamp,
      })
      .select('*, sender:users!messages_sender_id_fkey(id, name, email, avatar_url)')
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json(
      decryptMessageRecord(message as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Create message error:', error);
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    const body = await request.json();
    const { action, messageId } = body;
    const content = sanitizeText(body?.content);

    if (!action) {
      const { error } = await supabase
        .from('messages')
        .update({ read: true })
        .eq('recipient_id', session.userId)
        .eq('read', false);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'mark-read' && messageId) {
      const { error } = await supabase
        .from('messages')
        .update({ read: true })
        .eq('id', messageId)
        .eq('recipient_id', session.userId);

      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'edit' && messageId && content) {
      const { data: message, error: fetchError } = await supabase
        .from('messages')
        .select('sender_id, recipient_id')
        .eq('id', messageId)
        .single();

      if (fetchError || !message || message.sender_id !== session.userId) {
        return NextResponse.json(
          {
            error: 'Unauthorized to edit this message',
            debug: {
              currentUser: session.userId,
              messageSender: message?.sender_id,
              fetchError: fetchError?.message,
            },
          },
          { status: 403 }
        );
      }

      const { data: updatedMessage, error } = await supabase
        .from('messages')
        .update({ content: encryptValue(content) })
        .eq('id', messageId)
        .select('*, sender:users!messages_sender_id_fkey(id, name, email, avatar_url)')
        .single();

      if (error) throw error;

      return NextResponse.json(
        decryptMessageRecord(updatedMessage as Record<string, unknown>)
      );
    }

    if (action === 'delete' && messageId) {
      const { data: message, error: fetchError } = await supabase
        .from('messages')
        .select('sender_id, recipient_id')
        .eq('id', messageId)
        .single();

      if (fetchError || !message || message.sender_id !== session.userId) {
        return NextResponse.json(
          {
            error: 'Unauthorized to delete this message',
            debug: {
              currentUser: session.userId,
              messageSender: message?.sender_id,
              fetchError: fetchError?.message,
            },
          },
          { status: 403 }
        );
      }

      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;

      return NextResponse.json({ success: true, messageId });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Message operation error:', error);
    return NextResponse.json(
      { error: 'Failed to perform message operation' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createClient();

    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('id');

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 });
    }

    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('sender_id, recipient_id')
      .eq('id', messageId)
      .single();

    if (fetchError || !message || message.sender_id !== session.userId) {
      return NextResponse.json(
        {
          error: 'Unauthorized to delete this message',
          debug: {
            currentUser: session.userId,
            messageSender: message?.sender_id,
            fetchError: fetchError?.message,
          },
        },
        { status: 403 }
      );
    }

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId);

    if (error) throw error;

    return NextResponse.json({ success: true, messageId });
  } catch (error) {
    console.error('Delete message error:', error);
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    );
  }
}