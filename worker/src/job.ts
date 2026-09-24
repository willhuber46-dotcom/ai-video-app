import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { CUT_RETENTION_DAYS, STORAGE_BUCKETS, type RenderRow, type VideoRow } from '@app/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

import { renderCost, type CostEntry } from './costs';
import { notifyIfBatchComplete, type PushSender } from './notify';
import { renderFinal } from './render';
import type { RetakeDetector } from './retakes';
import type { SuggestionGenerator } from './suggestions';
import { editTalkingVideo, UserFacingError } from './talking';
import type { Transcriber } from './transcribe';

export type JobDeps = {
  db: SupabaseClient;
  transcriber: Transcriber;
  retakes: RetakeDetector;
  suggestions: SuggestionGenerator;
  push: PushSender;
  tmpDir: string;
};

const GENERIC_ERROR = 'Something went wrong while editing this video. Tap Retry to try again.';

export async function claimNextVideo(db: SupabaseClient): Promise<VideoRow | null> {
  const { data, error } = await db.rpc('claim_next_video');
  if (error) throw error;
  return (data as VideoRow[] | null)?.[0] ?? null;
}

export async function processVideo(video: VideoRow, deps: JobDeps): Promise<void> {
  const { db } = deps;
  const workDir = path.join(deps.tmpDir, video.id);
  await mkdir(workDir, { recursive: true });

  try {
    if (video.mode !== 'talking') throw new UserFacingError('This mode is coming soon.');
    if (!video.raw_path) throw new Error('Video has no raw_path');

    const inputPath = path.join(workDir, 'input' + (path.extname(video.raw_path) || '.mp4'));
    await download(db, STORAGE_BUCKETS.raw, video.raw_path, inputPath);

    const { data: profile } = await db.from('profiles').select('record_language').eq('id', video.user_id).single();

    const result = await editTalkingVideo({
      inputPath,
      workDir,
      pacing: video.pacing,
      language: profile?.record_language ?? 'en',
      transcriber: deps.transcriber,
      retakes: deps.retakes,
      suggestions: deps.suggestions,
    });

    const outputPath = `${video.user_id}/${video.id}.mp4`;
    const thumbnailPath = `${video.user_id}/${video.id}.jpg`;
    await upload(db, STORAGE_BUCKETS.cuts, outputPath, result.outputPath, 'video/mp4');
    await upload(db, STORAGE_BUCKETS.cuts, thumbnailPath, result.thumbnailPath, 'image/jpeg');

    const now = new Date();
    const { error: updateError } = await db
      .from('videos')
      .update({
        status: 'done',
        error: null,
        output_path: outputPath,
        thumbnail_path: thumbnailPath,
        source_duration_s: result.sourceDuration,
        output_duration_s: result.outputDuration,
        output_width: result.outputWidth,
        output_height: result.outputHeight,
        transcript: result.transcript,
        ai_suggestions: result.suggestions,
        edit_decisions: result.decisions,
        completed_at: now.toISOString(),
        expires_at: new Date(now.getTime() + CUT_RETENTION_DAYS * 86_400_000).toISOString(),
        raw_path: null,
      })
      .eq('id', video.id);
    if (updateError) throw updateError;

    // Raw uploads are deleted once editing finishes.
    const { error: removeError } = await db.storage.from(STORAGE_BUCKETS.raw).remove([video.raw_path]);
    if (removeError) console.warn(`Could not delete raw upload ${video.raw_path}`, removeError);

    await logCosts(db, video, result.costs);
    console.log(
      `Done ${video.id}: ${result.sourceDuration.toFixed(1)}s -> ${result.outputDuration.toFixed(1)}s, ` +
        `$${result.costs.reduce((s, c) => s + c.usd, 0).toFixed(4)}`,
    );
  } catch (err) {
    console.error(`Failed ${video.id}`, err);
    const message = err instanceof UserFacingError ? err.message : GENERIC_ERROR;
    await db.from('videos').update({ status: 'failed', error: message }).eq('id', video.id);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  // Last video of its batch? Let the user know, even if they closed the app.
  if (video.batch_id) {
    try {
      if (await notifyIfBatchComplete(db, video.batch_id, deps.push)) console.log(`Batch ${video.batch_id} finished`);
    } catch (err) {
      console.warn(`Could not send batch notification for ${video.batch_id}`, err);
    }
  }
}

/** Streams a storage object to disk; raw uploads can be over a gigabyte. */
async function download(db: SupabaseClient, bucket: string, objectPath: string, dest: string) {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(objectPath, 600);
  if (error || !data) throw error ?? new Error('No signed URL');
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${bucket}/${objectPath}`);
  await pipeline(Readable.fromWeb(res.body as WebReadableStream), createWriteStream(dest));
}

async function upload(db: SupabaseClient, bucket: string, objectPath: string, file: string, contentType: string) {
  const { error } = await db.storage.from(bucket).upload(objectPath, await readFile(file), { contentType, upsert: true });
  if (error) throw error;
}

export async function claimNextRender(db: SupabaseClient): Promise<RenderRow | null> {
  const { data, error } = await db.rpc('claim_next_render');
  if (error) throw error;
  return (data as RenderRow[] | null)?.[0] ?? null;
}

/** Burns a video's captions, text and zooms into a final MP4 for saving. */
export async function processRender(render: RenderRow, deps: Pick<JobDeps, 'db' | 'tmpDir'>): Promise<void> {
  const { db } = deps;
  const started = Date.now();
  const workDir = path.join(deps.tmpDir, `render-${render.id}`);
  await mkdir(workDir, { recursive: true });

  try {
    const { data: video, error } = await db.from('videos').select('*').eq('id', render.video_id).single<VideoRow>();
    if (error) throw error;
    if (!video.output_path) throw new UserFacingError('This video is no longer available.');

    const input = path.join(workDir, 'cut.mp4');
    await download(db, STORAGE_BUCKETS.cuts, video.output_path, input);
    const output = path.join(workDir, 'final.mp4');
    await renderFinal({ input, doc: render.overlays, output, workDir });

    const outputPath = `${video.user_id}/${video.id}-final-${render.id}.mp4`;
    await upload(db, STORAGE_BUCKETS.cuts, outputPath, output, 'video/mp4');
    const { error: updateError } = await db
      .from('renders')
      .update({ status: 'done', output_path: outputPath, completed_at: new Date().toISOString() })
      .eq('id', render.id);
    if (updateError) throw updateError;

    // Only the newest final render is kept.
    const { data: older } = await db
      .from('renders')
      .select('id, output_path')
      .eq('video_id', video.id)
      .neq('id', render.id)
      .not('output_path', 'is', null);
    if (older?.length) {
      await db.storage.from(STORAGE_BUCKETS.cuts).remove(older.map((r) => r.output_path as string));
      await db.from('renders').update({ output_path: null }).in('id', older.map((r) => r.id));
    }

    await logCosts(db, video, [renderCost((Date.now() - started) / 1000)]);
    console.log(`Rendered ${render.id} for video ${video.id}`);
  } catch (err) {
    console.error(`Render failed ${render.id}`, err);
    const message = err instanceof UserFacingError ? err.message : 'Something went wrong while saving. Please try again.';
    await db.from('renders').update({ status: 'failed', error: message }).eq('id', render.id);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function logCosts(db: SupabaseClient, video: Pick<VideoRow, 'id' | 'user_id'>, costs: CostEntry[]) {
  const { error } = await db.from('processing_costs').insert(
    costs.map((c) => ({
      video_id: video.id,
      user_id: video.user_id,
      kind: c.kind,
      provider: c.provider,
      units: c.units,
      unit: c.unit,
      usd: c.usd,
      meta: c.meta ?? null,
    })),
  );
  if (error) console.warn(`Could not log costs for ${video.id}`, error);
}
