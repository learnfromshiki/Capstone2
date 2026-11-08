import { supabase } from './supabaseClient';

/**
 * Add points to a user's profile and log the reward
 * @param {string} userId - User UUID
 * @param {number} points - Points to add
 * @param {string} source - Source of the reward (e.g., 'shop_purchase')
 */
export const addPoints = async (userId, points, source) => {
  // Nothing to award (e.g. an order under ₱100, which earns 0 points)
  if (!userId || !points || points <= 0) {
    return { success: true, newPoints: null };
  }

  try {
    // 1. Get current user points (maybeSingle: a missing profile is not an error)
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('points')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!profile) {
      console.warn('No profile row for user, skipping points:', userId);
      return { success: false, error: 'Profile not found' };
    }

    // 2. Update profile points
    const newPoints = (profile.points || 0) + points;
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ points: newPoints })
      .eq('id', userId);

    if (updateError) throw updateError;

    // 3. Insert into reward_history
    const { error: historyError } = await supabase
      .from('reward_history')
      .insert({
        user_id: userId,
        subsystem_source: source,
        points_earned: points,
      });

    if (historyError) throw historyError;

    return { success: true, newPoints };
  } catch (error) {
    console.error('Error adding points:', error);
    return { success: false, error: error.message };
  }
};
