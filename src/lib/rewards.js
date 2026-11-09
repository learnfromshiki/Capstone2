import { supabase } from './supabaseClient';

const isMissingFunction = (error) =>
  error?.code === 'PGRST202' ||
  /could not find the function|function .* does not exist/i.test(error?.message || '');

/**
 * Add points to a user's profile and log the reward.
 *
 * Preference order:
 * 1. add_reward_points() RPC (atomic, idempotent by reference ID, and safe
 *    after RLS is hardened). See supabase-security-hardening.sql.
 * 2. Legacy read/modify/write with optimistic locking, which works on the
 *    current deployment but is only as safe as the RLS policies around it.
 *
 * @param {string} userId - User UUID
 * @param {number} points - Points to add
 * @param {string} source - Source of the reward (e.g., 'shop_purchase')
 * @param {string|null} referenceId - Unique reference (order ID) for idempotency
 */
export const addPoints = async (userId, points, source, referenceId = null) => {
  const amount = Number(points);

  // Nothing to award (e.g. an order under ₱100, which earns 0 points)
  if (!userId || !Number.isInteger(amount) || amount <= 0) {
    return { success: true, newPoints: null };
  }

  const rewardSource = typeof source === 'string' && source.trim() ? source.trim() : 'unknown';

  try {
    const { data, error } = await supabase.rpc('add_reward_points', {
      p_points: amount,
      p_source: rewardSource,
      p_reference: referenceId || null,
    });

    if (!error) {
      return { success: true, newPoints: data };
    }

    if (!isMissingFunction(error)) {
      throw error;
    }
  } catch (rpcError) {
    // A network failure should fail loudly. Only a missing function falls back.
    if (!isMissingFunction(rpcError)) {
      console.error('Error adding points through RPC:', rpcError);
      return { success: false, error: rpcError.message || 'Could not add points' };
    }
  }

  // ---------------------------------------------------------------
  // Legacy path for databases that have not run the hardening SQL yet.
  // ---------------------------------------------------------------
  try {
    let profile = null;
    let newPoints = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data: currentProfile, error: fetchError } = await supabase
        .from('profiles')
        .select('points')
        .eq('id', userId)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (!currentProfile) {
        console.warn('No profile row for user, skipping points:', userId);
        return { success: false, error: 'Profile not found' };
      }

      profile = currentProfile;
      const currentPoints = Number(profile.points) || 0;

      let updateQuery = supabase
        .from('profiles')
        .update({ points: currentPoints + amount })
        .eq('id', userId);

      updateQuery = profile.points === null
        ? updateQuery.is('points', null)
        : updateQuery.eq('points', profile.points);

      const { data: updatedProfile, error: updateError } = await updateQuery
        .select('points')
        .maybeSingle();

      if (updateError) throw updateError;

      if (updatedProfile) {
        newPoints = updatedProfile.points;
        break;
      }
    }

    if (newPoints === null) {
      throw new Error('Points changed at the same time. Please try again.');
    }

    const historyPayload = {
      user_id: userId,
      subsystem_source: rewardSource,
      points_earned: amount,
    };

    if (referenceId) {
      historyPayload.reference_id = referenceId;
    }

    let { error: historyError } = await supabase
      .from('reward_history')
      .insert(historyPayload);

    // Older installations do not have reference_id yet.
    if (historyError && referenceId && /reference_id/i.test(historyError.message || '')) {
      delete historyPayload.reference_id;
      const retry = await supabase.from('reward_history').insert(historyPayload);
      historyError = retry.error;
    }

    // The points are already on the profile; a log failure must not fail the order.
    if (historyError) {
      console.warn('Points awarded but reward history was not written:', historyError.message);
    }

    return { success: true, newPoints };
  } catch (error) {
    console.error('Error adding points:', error);
    return { success: false, error: error.message };
  }
};
