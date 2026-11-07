import { supabase } from './supabaseClient';

/**
 * Add points to a user's profile and log the reward
 * @param {string} userId - User UUID
 * @param {number} points - Points to add
 * @param {string} source - Source of the reward (e.g., 'shop_purchase')
 */
export const addPoints = async (userId, points, source) => {
  try {
    // 1. Get current user points
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('points')
      .eq('id', userId)
      .single();

    if (fetchError) throw fetchError;

    // 2. Update profile points
    const newPoints = (profile?.points || 0) + points;
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
