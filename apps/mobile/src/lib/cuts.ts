import { STORAGE_BUCKETS, type EditMode, type OverlayDoc } from '@app/shared';

import { supabase } from '@/lib/supabase';

export type Cut = {
  id: string;
  batch_id: string | null;
  mode: EditMode;
  output_path: string;
  thumbnail_path: string | null;
  output_duration_s: number | null;
  created_at: string;
  completed_at: string;
  expires_at: string | null;
};

/** Finished edits, newest first. */
export async function fetchCuts(limit = 300): Promise<Cut[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('id, batch_id, mode, output_path, thumbnail_path, output_duration_s, created_at, completed_at, expires_at')
    .eq('status', 'done')
    .not('output_path', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as Cut[];
}

/** Signed thumbnail URLs in one request, keyed by storage path. */
export async function thumbnailUrls(cuts: Cut[]): Promise<Record<string, string>> {
  const paths = cuts.map((c) => c.thumbnail_path).filter((p): p is string => Boolean(p));
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from(STORAGE_BUCKETS.cuts).createSignedUrls(paths, 3600);
  if (error) throw error;
  const urls: Record<string, string> = {};
  for (const item of data) if (item.path && item.signedUrl) urls[item.path] = item.signedUrl;
  return urls;
}

export async function fetchOverlays(ids: string[]): Promise<Record<string, OverlayDoc | null>> {
  const { data, error } = await supabase.from('videos').select('id, overlays').in('id', ids);
  if (error) throw error;
  return Object.fromEntries(data.map((row) => [row.id as string, row.overlays as OverlayDoc | null]));
}

/** Deletes cuts and all their files (cut, thumbnail, final renders). */
export async function deleteCuts(cuts: Cut[]): Promise<void> {
  if (cuts.length === 0) return;
  const ids = cuts.map((c) => c.id);
  const { data: renders, error: renderError } = await supabase
    .from('renders')
    .select('output_path')
    .in('video_id', ids);
  if (renderError) throw renderError;
  const files = [
    ...cuts.flatMap((c) => [c.output_path, c.thumbnail_path]),
    ...(renders ?? []).map((r) => r.output_path as string | null),
  ].filter((p): p is string => Boolean(p));
  const { error: removeError } = await supabase.storage.from(STORAGE_BUCKETS.cuts).remove(files);
  if (removeError) throw removeError;
  const { error } = await supabase.from('videos').delete().in('id', ids);
  if (error) throw error;
}
