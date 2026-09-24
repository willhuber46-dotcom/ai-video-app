import { STORAGE_BUCKETS, type EditMode, type Pacing, type VideoRow } from '@app/shared';
import { File } from 'expo-file-system';

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';

export type PickedVideo = {
  uri: string;
  /** Seconds. */
  duration: number | null;
  mimeType: string;
  fileName: string | null;
};

const VIDEO_COLUMNS =
  'id, user_id, batch_id, mode, clip_type, pacing, status, error, raw_path, source_duration_s, output_path, thumbnail_path, output_duration_s, edit_decisions, attempts, created_at, updated_at, completed_at, expires_at';

export type VideoSummary = Omit<VideoRow, 'transcript'>;

/** Creates the batch and video rows before the upload starts, so status is tracked from the first byte. */
export async function createVideo(video: PickedVideo, mode: EditMode, pacing: Pacing): Promise<VideoSummary> {
  const { data: batch, error: batchError } = await supabase.from('batches').insert({}).select('id').single();
  if (batchError) throw batchError;
  const { data, error } = await supabase
    .from('videos')
    .insert({ batch_id: batch.id, mode, pacing, source_duration_s: video.duration })
    .select(VIDEO_COLUMNS)
    .single();
  if (error) throw error;
  return data as VideoSummary;
}

function extensionFor(video: PickedVideo): string {
  const fromName = video.fileName?.match(/\.(\w+)$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  return video.mimeType === 'video/quicktime' ? 'mov' : 'mp4';
}

/**
 * Streams the file straight from disk to Supabase Storage (it never gets
 * loaded into JS memory). On iOS the native session keeps going if the user
 * switches apps.
 */
export async function uploadRaw(
  videoRow: VideoSummary,
  video: PickedVideo,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You are signed out. Sign in and try again.');

  const path = `${videoRow.user_id}/${videoRow.id}.${extensionFor(video)}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKETS.raw}/${path}`;
  const task = new File(video.uri).createUploadTask(url, {
    httpMethod: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
      'x-upsert': 'true',
      'Content-Type': video.mimeType,
    },
    mimeType: video.mimeType,
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesSent / totalBytes);
    },
  });
  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status}): ${result.body.slice(0, 200)}`);
  }
  return path;
}

/** Hands the uploaded video to the editing queue. */
export async function submitVideo(videoId: string, rawPath: string): Promise<void> {
  const { error } = await supabase.from('videos').update({ raw_path: rawPath, status: 'queued', error: null }).eq('id', videoId);
  if (error) throw error;
}

export async function markUploadFailed(videoId: string, message: string): Promise<void> {
  await supabase.from('videos').update({ status: 'failed', error: message }).eq('id', videoId);
}

export async function fetchVideo(videoId: string): Promise<VideoSummary> {
  const { data, error } = await supabase.from('videos').select(VIDEO_COLUMNS).eq('id', videoId).single();
  if (error) throw error;
  return data as VideoSummary;
}

export async function fetchRecentVideos(limit = 20): Promise<VideoSummary[]> {
  const { data, error } = await supabase
    .from('videos')
    .select(VIDEO_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as VideoSummary[];
}

export async function signedCutUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKETS.cuts).createSignedUrl(path, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

/** Retries with exponential backoff: 2s, 4s, ... */
export async function withRetries<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
    }
  }
  throw lastError;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
