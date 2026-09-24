import type { ProfileRow } from '@app/shared';

import { supabase } from '@/lib/supabase';

export type Profile = ProfileRow & { plan: string; cuts_made: number };

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'record_language'>>,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

/** Cuts finished since the first of this month. */
export async function cutsThisMonth(): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'done')
    .gte('completed_at', start.toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** Files the deletion request; the server removes all data shortly after. */
export async function requestAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('request_account_deletion');
  if (error) throw error;
}
