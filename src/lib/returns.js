'use client';

import { supabase } from './supabaseClient';
import { requestBadgeRefresh } from './badges';

/**
 * Returns, refunds and review replies (supabase-returns-reviews.sql). The
 * database functions decide who may do what; these only call them and turn
 * a missing setup into a readable message.
 */

const NOT_SET_UP = 'This is not set up yet. Ask the admin to run supabase-returns-reviews.sql in Supabase.';

const isMissing = (error) =>
  /function .* does not exist|could not find the function|relation .* does not exist|schema cache/i.test(
    error?.message || ''
  );

const call = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(isMissing(error) ? NOT_SET_UP : error.message || 'Something went wrong.');
  requestBadgeRefresh();
  return data;
};

export const RETURN_REASONS = [
  'Item arrived damaged',
  'Wrong item or wrong option sent',
  'Item is missing parts or quantity',
  'Item is different from the description or photos',
  'Ordered by mistake',
  'Other',
];

export const RETURN_STATUS = {
  requested: { label: 'Waiting for the shop', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Approved, refund in progress', tone: 'bg-blue-50 text-blue-800 border-blue-200' },
  declined: { label: 'Declined', tone: 'bg-gray-50 text-gray-700 border-gray-200' },
  refunded: { label: 'Refunded', tone: 'bg-green-50 text-green-800 border-green-200' },
};

/** Return days allowed after delivery (must match request_return()). */
export const RETURN_DAYS = 7;

/** Whether this order can get a Return / Refund request right now. */
export const canRequestReturn = (order, existing) => {
  if (!order || (existing && ['requested', 'approved', 'refunded'].includes(existing.status))) return false;
  if (order.status === 'delivered') {
    const since = order.delivered_at || order.updated_at;
    return !since || Date.now() - new Date(since).getTime() < RETURN_DAYS * 24 * 60 * 60 * 1000;
  }
  return order.payment_status === 'paid' && ['pending', 'confirmed', 'processing'].includes(order.status);
};

/** { [orderId]: latest request } for the orders this account can see. */
export const fetchReturnRequests = async () => {
  const { data, error } = await supabase
    .from('shop_return_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    if (!isMissing(error)) console.warn('Return requests unavailable:', error.message);
    return {};
  }
  const byOrder = {};
  (data || []).forEach((request) => {
    if (!byOrder[request.order_id]) byOrder[request.order_id] = request;
  });
  return byOrder;
};

export const requestReturn = (orderId, { reason, details, photos }) =>
  call('request_return', { p_order_id: orderId, p_reason: reason, p_details: details || null, p_photos: photos || [] });

export const respondReturn = (requestId, approve, note) =>
  call('respond_return', { p_request_id: requestId, p_approve: approve, p_note: note || null });

export const markOrderRefunded = (orderId, note) =>
  call('mark_order_refunded', { p_order_id: orderId, p_note: note || null });

export const replyToReview = (reviewId, reply) => call('reply_to_review', { p_review_id: reviewId, p_reply: reply });

export const moderateReview = (reviewId, action) => call('moderate_review', { p_review_id: reviewId, p_action: action });
