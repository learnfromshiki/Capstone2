'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from '@/components/ui/Avatar';
import { useDialog } from '@/components/ui/Dialog';
import { kindOf, uploadAttachment } from '@/lib/attachments';
import {
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  unreadCounts,
} from '@/lib/messages';

const POLL_MS = 6000;

const formatTime = (value) =>
  new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The message inbox, shared by the customer dashboard and the seller
 * dashboard. `role` decides whose side we are on: a customer sees shop names,
 * a shop sees customer names.
 *
 * New messages are picked up by asking every few seconds, which needs no
 * extra setup in Supabase and is plenty for a conversation.
 */
export default function ChatPanel({ role, sellerId, shopNameById = {}, activeConversationId, onOpened }) {
  const [conversations, setConversations] = useState([]);
  const [unread, setUnread] = useState({});
  const [selectedId, setSelectedId] = useState(activeConversationId || null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // The photo or video waiting to go with the next message
  const [pending, setPending] = useState(null); // { file, preview, type }
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const { showAlert } = useDialog();

  const titleFor = useCallback(
    (conversation) =>
      role === 'seller'
        ? conversation.buyer_name || 'Customer'
        : shopNameById[conversation.seller_id] || 'Shop',
    [role, shopNameById]
  );

  const loadConversations = useCallback(async () => {
    try {
      const rows = await listConversations(role, sellerId);
      setConversations(rows);

      const counts = await unreadCounts(rows.map((row) => row.id), role);
      setUnread(counts);

      setSelectedId((current) => current || rows[0]?.id || null);
    } catch (error) {
      console.warn('Could not load conversations:', error.message);
    } finally {
      setLoading(false);
    }
  }, [role, sellerId]);

  const loadMessages = useCallback(
    async (conversationId) => {
      if (!conversationId) return;
      try {
        const rows = await listMessages(conversationId);
        setMessages(rows);
        await markConversationRead(conversationId, role);
        setUnread((current) => ({ ...current, [conversationId]: 0 }));
      } catch (error) {
        console.warn('Could not load messages:', error.message);
      }
    },
    [role]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeConversationId) setSelectedId(activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    loadMessages(selectedId);
    if (selectedId && onOpened) onOpened(selectedId);
  }, [selectedId, loadMessages, onOpened]);

  // Keep the open thread and the unread badges fresh
  useEffect(() => {
    const timer = setInterval(() => {
      loadConversations();
      if (selectedId) loadMessages(selectedId);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [loadConversations, loadMessages, selectedId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Picking a file only previews it; it is uploaded when the message is sent,
  // so changing your mind costs nothing.
  const handleChooseFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const type = kindOf(file);
    if (!type) {
      showAlert('Please choose a JPG, PNG, GIF or WebP photo, or an MP4, WebM or MOV video.');
      return;
    }

    setPending({ file, type, preview: URL.createObjectURL(file) });
  };

  const clearPending = () => {
    setPending((current) => {
      if (current?.preview) URL.revokeObjectURL(current.preview);
      return null;
    });
  };

  const handleSend = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !pending) || !selectedId || sending) return;

    setSending(true);
    try {
      let attachment = null;

      if (pending) {
        setUploading(true);
        attachment = await uploadAttachment(pending.file, 'chat');
      }

      const saved = await sendMessage(selectedId, role, text, attachment);
      setDraft('');
      clearPending();
      if (saved) setMessages((current) => [...current, saved]);
      loadConversations();
    } catch (error) {
      showAlert(error.message || 'Could not send your message.');
    } finally {
      setUploading(false);
      setSending(false);
    }
  };

  const selected = conversations.find((conversation) => conversation.id === selectedId) || null;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b p-6">
        <h2 className="text-2xl font-bold text-gray-900">Messages</h2>
        <p className="mt-1 text-sm text-gray-600">
          {role === 'seller'
            ? 'Questions from customers about your products.'
            : 'Ask a shop about a product, delivery or payment.'}
        </p>
      </div>

      {loading ? (
        <p className="p-6 text-sm text-gray-500">Loading your messages...</p>
      ) : conversations.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-lg font-semibold text-gray-900">No messages yet</p>
          <p className="mt-1 text-sm text-gray-600">
            {role === 'seller'
              ? 'When a customer asks about one of your products, the conversation appears here.'
              : 'Open a product and tap "Message shop" to start a conversation.'}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-[260px,1fr]">
          {/* Threads */}
          <ul className="max-h-64 divide-y overflow-y-auto border-b md:max-h-[28rem] md:border-b-0 md:border-r">
            {conversations.map((conversation) => {
              const count = unread[conversation.id] || 0;
              const active = conversation.id === selectedId;

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                      active ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Avatar
                      src={role === 'seller' ? conversation.buyer_avatar_url : null}
                      name={titleFor(conversation)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {titleFor(conversation)}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {formatTime(conversation.last_message_at)}
                      </span>
                    </span>
                    {count > 0 && (
                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                        {count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Thread */}
          <div className="flex min-h-[20rem] flex-col md:h-[28rem]">
            <div className="border-b px-4 py-3">
              <p className="font-semibold text-gray-900">{selected ? titleFor(selected) : 'Select a conversation'}</p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-500">
                  No messages yet. Say hello.
                </p>
              ) : (
                messages.map((message) => {
                  const mine = message.sender_role === role;
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                          mine ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 shadow-sm'
                        }`}
                      >
                        {message.attachment_url && (
                          <a
                            href={message.attachment_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mb-1.5 block overflow-hidden rounded-xl"
                          >
                            {message.attachment_type === 'video' ? (
                              <video
                                src={message.attachment_url}
                                controls
                                className="max-h-56 w-full rounded-xl bg-black"
                              />
                            ) : (
                              <img
                                src={message.attachment_url}
                                alt="Attachment"
                                className="max-h-56 w-full rounded-xl object-cover"
                              />
                            )}
                          </a>
                        )}
                        {message.body && (
                          <p className="whitespace-pre-line break-words text-sm">{message.body}</p>
                        )}
                        <p className={`mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                          {formatTime(message.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={handleSend} className="border-t p-3">
              {/* What is about to go with the message */}
              {pending && (
                <div className="mb-2 flex items-center gap-3 rounded-xl bg-gray-50 p-2">
                  {pending.type === 'video' ? (
                    <video src={pending.preview} className="h-16 w-16 rounded-lg bg-black object-cover" />
                  ) : (
                    <img src={pending.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  )}
                  <p className="min-w-0 flex-1 truncate text-xs text-gray-600">
                    {pending.type === 'video' ? 'Video' : 'Photo'} ready to send
                  </p>
                  <button
                    type="button"
                    onClick={clearPending}
                    aria-label="Remove the attachment"
                    className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/mp4,video/webm,video/quicktime"
                  onChange={handleChooseFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!selectedId || sending}
                  aria-label="Attach a photo or video"
                  title="Attach a photo or video"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border-2 border-gray-200 text-gray-500 transition-colors hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={pending ? 'Add a caption (optional)...' : 'Write a message...'}
                  maxLength={2000}
                  disabled={!selectedId}
                  aria-label="Message"
                  className="min-h-[44px] flex-1 rounded-full border-2 border-gray-200 px-4 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={(!draft.trim() && !pending) || sending || !selectedId}
                  className="min-h-[44px] rounded-full bg-blue-600 px-5 font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : sending ? '...' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
