import { STORAGE_BUCKETS, type EditMode, type Pacing, type VideoRow } from '@app/shared';
import { File } from 'expo-file-system';

import { SUPABASE_ANON_KEY, supabase } from '@/lib/supabase';

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

export type BatchItem = {
  /** One clip = Single Clip; several = Multiple Clips, combined into one video. */
  clips: PickedVideo[];
  /** Voiceover Mode's separate voice recording. */
  voice: PickedVideo | null;
  mode: EditMode;
  pacing: Pacing;
};

/** A file to upload for a video: stored under the video's id (single clip) or its clip row's id. */
export type UploadFile = { objectId: string; file: PickedVideo };

export type CreatedVideo = { row: VideoSummary; files: UploadFile[] };

/** Multiple Clips and Voiceover need a row per file; a single clip uploads under the video's id. */
function usesClipRows(item: BatchItem): boolean {
  return item.clips.length > 1 || item.voice !== null;
}

/**
 * Creates the batch and one row per video (plus clip rows where needed)
 * before any upload starts, so status is tracked from the first byte.
 */
export async function createBatch(items: BatchItem[]): Promise<CreatedVideo[]> {
  const { data: batch, error: batchError } = await supabase.from('batches').insert({}).select('id').single();
  if (batchError) throw batchError;
  const created: CreatedVideo[] = [];
  try {
    await insertBatchVideos(batch.id, items, created);
  } catch (err) {
    // All or nothing: don't leave half a batch waiting for uploads that never start.
    await supabase.from('videos').delete().eq('batch_id', batch.id);
    await supabase.from('batches').delete().eq('id', batch.id);
    throw err;
  }
  return created;
}

async function insertBatchVideos(batchId: string, items: BatchItem[], created: CreatedVideo[]): Promise<void> {
  // One insert per video keeps the order explicit.
  for (const item of items) {
    const duration = item.clips.every((c) => c.duration != null)
      ? item.clips.reduce((sum, c) => sum + (c.duration ?? 0), 0)
      : null;
    const { data, error } = await supabase
      .from('videos')
      .insert({
        batch_id: batchId,
        mode: item.mode,
        pacing: item.pacing,
        clip_type: item.clips.length > 1 ? 'multiple' : 'single',
        source_duration_s: duration,
      })
      .select(VIDEO_COLUMNS)
      .single();
    if (error) throw error;
    const row = data as VideoSummary;

    if (!usesClipRows(item)) {
      created.push({ row, files: [{ objectId: row.id, file: item.clips[0] }] });
      continue;
    }
    const entries = [
      ...item.clips.map((file, position) => ({ kind: 'clip' as const, position, file })),
      ...(item.voice ? [{ kind: 'voice' as const, position: 0, file: item.voice }] : []),
    ];
    const { data: clipRows, error: clipError } = await supabase
      .from('clips')
      .insert(entries.map((e) => ({ video_id: row.id, kind: e.kind, position: e.position, duration_s: e.file.duration })))
      .select('id, kind, position');
    if (clipError) throw clipError;
    created.push({
      row,
      files: entries.map((e) => ({
        objectId: clipRows.find((c) => c.kind === e.kind && c.position === e.position)!.id as string,
        file: e.file,
      })),
    });
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  'video/quicktime': 'mov',
  'video/mp4': 'mp4',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
};

function extensionFor(file: PickedVideo): string {
  const fromName = file.fileName?.match(/\.(\w+)$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  return MIME_EXTENSIONS[file.mimeType] ?? 'mp4';
}

/**
 * Streams a file straight from disk to Supabase Storage (it never gets
 * loaded into JS memory). The signed URL doesn't depend on the login session,
 * and on iOS the native background session keeps sending while the app is in
 * the background. The server queues the video once all its files have landed.
 */
export async function uploadFile(userId: string, upload: UploadFile, onProgress: (fraction: number) => void): Promise<string> {
  const path = `${userId}/${upload.objectId}.${extensionFor(upload.file)}`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKETS.raw).createSignedUploadUrl(path, { upsert: true });
  if (error) throw error;

  const task = new File(upload.file.uri).createUploadTask(data.signedUrl, {
    httpMethod: 'PUT',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      'x-upsert': 'true',
      'Content-Type': upload.file.mimeType,
    },
    mimeType: upload.file.mimeType,
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

/**
 * Re-queues a video whose files are all on the server: after a failed edit,
 * or as a backup to the storage trigger. Returns false if files are missing.
 */
export async function retryVideo(videoId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('retry_video', { p_video_id: videoId });
  if (error) throw error;
  return Boolean(data);
}

export async function markUploadFailed(videoId: string, message: string): Promise<void> {
  await supabase.from('videos').update({ status: 'failed', error: message }).eq('id', videoId);
}

export async function fetchVideo(videoId: string): Promise<VideoSummary> {
  const { data, error } = await supabase.from('videos').select(VIDEO_COLUMNS).eq('id', videoId).single();
  if (error) throw error;
  return data as VideoSummary;
}

export async function fetchRecentVideos(limit = 50): Promise<VideoSummary[]> {
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

export async function deleteVideo(videoId: string): Promise<void> {
  const { error } = await supabase.from('videos').delete().eq('id', videoId);
  if (error) throw error;
}
