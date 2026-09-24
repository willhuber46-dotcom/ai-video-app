import { expiryPushMessage, STORAGE_BUCKETS } from '@app/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PushSender } from './notify';

/**
 * Periodic housekeeping, run by whichever worker holds the lease:
 * 1. push a warning 3 days before cuts are auto-deleted,
 * 2. delete cuts older than 30 days (and their files),
 * 3. delete stale failed/abandoned videos and their raw uploads,
 * 4. carry out account deletion requests.
 */

const LEASE = 'maintenance';
const BATCH = 100;
/** Failed or never-finished uploads are cleaned up after this long. */
const ABANDONED_DAYS = 30;

export async function runMaintenance(db: SupabaseClient, push: PushSender, leaseSeconds: number): Promise<void> {
  const { data: leased, error } = await db.rpc('acquire_lease', { p_name: LEASE, p_seconds: leaseSeconds });
  if (error) throw error;
  if (!leased) return;

  await sendExpiryWarnings(db, push);
  await deleteExpiredCuts(db);
  await deleteAbandonedVideos(db);
  await processAccountDeletions(db);
}

async function sendExpiryWarnings(db: SupabaseClient, push: PushSender) {
  const { data, error } = await db.rpc('claim_expiry_warnings');
  if (error) throw error;
  for (const row of (data ?? []) as { user_id: string; cuts: number }[]) {
    const { data: tokens } = await db.from('push_tokens').select('token').eq('user_id', row.user_id);
    if (!tokens?.length) continue;
    const { title, body } = expiryPushMessage(row.cuts);
    const { invalidTokens } = await push.send(
      tokens.map((t) => ({ to: t.token as string, title, body, data: { screen: 'cuts' } })),
    );
    if (invalidTokens.length) await db.from('push_tokens').delete().in('token', invalidTokens);
  }
}

type VideoFiles = { id: string; output_path: string | null; thumbnail_path: string | null; raw_path: string | null };

/** Removes the videos' files (cut, thumbnail, final renders, raw upload), then the rows. */
export async function deleteVideosWithFiles(db: SupabaseClient, videos: VideoFiles[]): Promise<void> {
  if (videos.length === 0) return;
  const ids = videos.map((v) => v.id);
  const { data: renders, error } = await db.from('renders').select('output_path').in('video_id', ids);
  if (error) throw error;

  const cutFiles = [
    ...videos.flatMap((v) => [v.output_path, v.thumbnail_path]),
    ...(renders ?? []).map((r) => r.output_path as string | null),
  ].filter((p): p is string => Boolean(p));
  const rawFiles = videos.map((v) => v.raw_path).filter((p): p is string => Boolean(p));

  if (cutFiles.length) {
    const { error: e } = await db.storage.from(STORAGE_BUCKETS.cuts).remove(cutFiles);
    if (e) throw e;
  }
  if (rawFiles.length) {
    const { error: e } = await db.storage.from(STORAGE_BUCKETS.raw).remove(rawFiles);
    if (e) throw e;
  }
  const { error: deleteError } = await db.from('videos').delete().in('id', ids);
  if (deleteError) throw deleteError;
}

async function deleteExpiredCuts(db: SupabaseClient) {
  for (;;) {
    const { data, error } = await db
      .from('videos')
      .select('id, output_path, thumbnail_path, raw_path')
      .eq('status', 'done')
      .lt('expires_at', new Date().toISOString())
      .limit(BATCH);
    if (error) throw error;
    if (!data?.length) return;
    await deleteVideosWithFiles(db, data);
    console.log(`Deleted ${data.length} expired cut(s)`);
    if (data.length < BATCH) return;
  }
}

async function deleteAbandonedVideos(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - ABANDONED_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from('videos')
    .select('id, output_path, thumbnail_path, raw_path')
    .in('status', ['failed', 'uploading'])
    .lt('updated_at', cutoff)
    .limit(BATCH);
  if (error) throw error;
  if (data?.length) {
    await deleteVideosWithFiles(db, data);
    console.log(`Deleted ${data.length} abandoned video(s)`);
  }
}

/** Removes every file in a user's folder, page by page. */
async function emptyUserFolder(db: SupabaseClient, bucket: string, userId: string) {
  for (;;) {
    const { data, error } = await db.storage.from(bucket).list(userId, { limit: BATCH });
    if (error) throw error;
    if (!data?.length) return;
    const { error: removeError } = await db.storage.from(bucket).remove(data.map((f) => `${userId}/${f.name}`));
    if (removeError) throw removeError;
  }
}

async function processAccountDeletions(db: SupabaseClient) {
  const { data, error } = await db.from('account_deletions').select('user_id').limit(20);
  if (error) throw error;
  for (const { user_id: userId } of data ?? []) {
    try {
      await emptyUserFolder(db, STORAGE_BUCKETS.raw, userId);
      await emptyUserFolder(db, STORAGE_BUCKETS.cuts, userId);
      // Cascades to profile, batches, videos, renders, costs' user link and the request row.
      const { error: deleteError } = await db.auth.admin.deleteUser(userId);
      if (deleteError) throw deleteError;
      console.log(`Deleted account ${userId}`);
    } catch (err) {
      console.error(`Could not delete account ${userId}; will retry`, err);
    }
  }
}
