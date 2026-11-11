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

export const listMessages = async (conversationId) => {
  const { data, error } = await supabase
    .from('shop_messages')
    .select('id, conversation_id, sender_id, sender_role, body, created_at, read_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500);

  if (error) {
    if (isMissingChat(error)) return [];
    throw new Error(error.message || 'Could not load this conversation.');
  }

  return data || [];
};

export const sendMessage = async (conversationId, senderRole, body) => {
  const text = (body || '').trim();
  if (!text) return null;
  if (text.length > 2000) throw new Error('Please keep your message under 2,000 characters.');

  const { data: authData } = await supabase.auth.getUser();
  const senderId = authData?.user?.id;
  if (!senderId) throw new Error('Please sign in again to send a message.');

  const { data, error } = await supabase
    .from('shop_messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, sender_role: senderRole, body: text })
    .select()
    .maybeSingle();

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
