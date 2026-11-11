import { supabase } from './supabaseClient';

/**
 * Chat between a customer and a shop.
 *
 * A pair of people share one thread, so a question about a second product
 * continues in the same conversation rather than starting a new one. Row
 * Level Security limits every read and write to the two participants (and
 * admins); see supabase-shipping-chat-gallery.sql.
 */

export const isMissingChat = (error) =>
  error?.code === '42P01' ||
  error?.code === 'PGRST202' ||
  /shop_conversations|shop_messages|get_or_create_conversation/i.test(error?.message || '');

const CHAT_NOT_READY =
  'Messaging is not set up yet. Ask the shop admin to run supabase-shipping-chat-gallery.sql in Supabase.';

/** Open (or reuse) the thread between the signed-in customer and a shop. */
export const openConversation = async (sellerId, productId = null) => {
  const { data, error } = await supabase.rpc('get_or_create_conversation', {
    p_seller_id: sellerId,
    p_product_id: productId,
  });

  if (error) {
    throw new Error(isMissingChat(error) ? CHAT_NOT_READY : error.message || 'Could not open the chat.');
  }

  return data;
};

/**
 * A shop opens the thread with one of its own customers. Only works for a
 * customer who has ordered from that shop.
 */
export const messageCustomer = async (buyerId, productId = null) => {
  const { data, error } = await supabase.rpc('message_customer', {
    p_buyer_id: buyerId,
    p_product_id: productId,
  });

  if (error) {
    throw new Error(isMissingChat(error) ? CHAT_NOT_READY : error.message || 'Could not open the chat.');
  }

  return data;
};

/**
 * Every thread for the signed-in person, newest first.
 * @param {'buyer'|'seller'} role
 * @param {string} [sellerId] - required for the seller side
 */
export const listConversations = async (role, sellerId) => {
  let query = supabase
    .from('shop_conversations')
    .select('id, buyer_id, seller_id, product_id, buyer_name, buyer_avatar_url, created_at, last_message_at')
    .order('last_message_at', { ascending: false })
    .limit(100);

  query = role === 'seller' ? query.eq('seller_id', sellerId) : query.eq('buyer_id', (await supabase.auth.getUser()).data?.user?.id);

  const { data, error } = await query;

  if (error) {
    if (isMissingChat(error)) return [];
    throw new Error(error.message || 'Could not load your messages.');
  }

  return data || [];
};

const BASE_MESSAGE_COLUMNS = 'id, conversation_id, sender_id, sender_role, body, created_at, read_at';

/** True when the attachment columns have not been added to the database yet. */
const isMissingAttachment = (error) =>
  /attachment_url|attachment_type/i.test(error?.message || '');

export const listMessages = async (conversationId) => {
  const read = (columns) =>
    supabase
      .from('shop_messages')
      .select(columns)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500);

  // Photos and videos arrive with supabase-notifications-payments.sql; an
  // older database still shows the text of every message.
  let { data, error } = await read(`${BASE_MESSAGE_COLUMNS}, attachment_url, attachment_type`);

  if (error && isMissingAttachment(error)) {
    ({ data, error } = await read(BASE_MESSAGE_COLUMNS));
  }

  if (error) {
    if (isMissingChat(error)) return [];
    throw new Error(error.message || 'Could not load this conversation.');
  }

  return data || [];
};

/**
 * Send a message. `attachment` is the { url, type } returned by
 * uploadAttachment(), and a message may be a photo or video on its own.
 */
export const sendMessage = async (conversationId, senderRole, body, attachment = null) => {
  const text = (body || '').trim();
  if (!text && !attachment?.url) return null;
  if (text.length > 2000) throw new Error('Please keep your message under 2,000 characters.');

  const { data: authData } = await supabase.auth.getUser();
  const senderId = authData?.user?.id;
  if (!senderId) throw new Error('Please sign in again to send a message.');

  const row = {
    conversation_id: conversationId,
    sender_id: senderId,
    sender_role: senderRole,
    body: text || null,
  };

  const send = (payload) => supabase.from('shop_messages').insert(payload).select().maybeSingle();

  let { data, error } = await send(
    attachment?.url
      ? { ...row, attachment_url: attachment.url, attachment_type: attachment.type || 'image' }
      : { ...row, body: text }
  );

  // Database without the attachment columns: keep the text, say why the file
  // could not go with it rather than losing the message.
  if (error && isMissingAttachment(error)) {
    if (!text) {
      throw new Error(
        'Attachments are not set up yet. Ask the admin to run supabase-notifications-payments.sql in Supabase.'
      );
    }
    ({ data, error } = await send({ ...row, body: text }));
  }

  if (error) {
    throw new Error(isMissingChat(error) ? CHAT_NOT_READY : error.message || 'Could not send your message.');
  }

  return data;
};

/** Mark the other side's messages in this thread as read. */
export const markConversationRead = async (conversationId, myRole) => {
  try {
    await supabase
      .from('shop_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .neq('sender_role', myRole)
      .is('read_at', null);
  } catch (error) {
    console.warn('Could not mark the conversation as read:', error?.message || error);
  }
};

/** Total messages waiting for this person, for the notification bell. */
export const countUnread = async (role, sellerId) => {
  try {
    const conversations = await listConversations(role, sellerId);
    if (conversations.length === 0) return 0;

    const counts = await unreadCounts(conversations.map((row) => row.id), role);
    return Object.values(counts).reduce((sum, value) => sum + value, 0);
  } catch (error) {
    return 0;
  }
};

/** How many messages are waiting, per conversation id. */
export const unreadCounts = async (conversationIds, myRole) => {
  if (!conversationIds || conversationIds.length === 0) return {};

  const { data, error } = await supabase
    .from('shop_messages')
    .select('conversation_id')
    .in('conversation_id', conversationIds)
    .neq('sender_role', myRole)
    .is('read_at', null);

  if (error) {
    if (!isMissingChat(error)) console.warn('Could not count unread messages:', error.message);
    return {};
  }

  return (data || []).reduce((acc, row) => {
    acc[row.conversation_id] = (acc[row.conversation_id] || 0) + 1;
    return acc;
  }, {});
};
