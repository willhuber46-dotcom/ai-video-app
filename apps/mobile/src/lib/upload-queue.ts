import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import {
  markUploadFailed,
  retryVideo,
  uploadFile,
  withRetries,
  type UploadFile,
  type VideoSummary,
} from '@/lib/videos';

/**
 * Uploads for a batch. Every upload starts at once so iOS can keep sending
 * them all in its background session while the user is in another app.
 * Pending uploads are saved to disk, so an upload interrupted by the app
 * being closed picks up again the next time the Batch tab opens.
 */

export type UploadJob = {
  videoId: string;
  userId: string;
  files: UploadFile[];
  /** Files already on the server, so a retry only re-sends the rest. */
  done?: string[];
};
export type UploadState = { progress: number; failed: boolean };

const STORAGE_KEY = 'pendingUploads.v2';

let states: ReadonlyMap<string, UploadState> = new Map();
const listeners = new Set<() => void>();

function setState(videoId: string, state: UploadState | null) {
  const next = new Map(states);
  if (state) next.set(videoId, state);
  else next.delete(videoId);
  states = next;
  listeners.forEach((l) => l());
}

/** Live progress of uploads running on this device, keyed by video id. */
export function useUploadStates(): ReadonlyMap<string, UploadState> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => states,
  );
}

async function loadPending(): Promise<Record<string, UploadJob>> {
  try {
    return JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}');
  } catch {
    return {};
  }
}

// Serialize writes so concurrent uploads don't clobber each other's entries.
let writeChain: Promise<unknown> = Promise.resolve();
function updatePending(change: (pending: Record<string, UploadJob>) => void): Promise<void> {
  const next = writeChain.then(async () => {
    const pending = await loadPending();
    change(pending);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  });
  writeChain = next.catch(() => {});
  return next;
}

const running = new Set<string>();

async function runUpload(job: UploadJob): Promise<void> {
  if (running.has(job.videoId)) return;
  running.add(job.videoId);
  const done = new Set(job.done ?? []);
  const progress = new Map(job.files.map((f) => [f.objectId, done.has(f.objectId) ? 1 : 0]));
  const report = () => {
    const values = [...progress.values()];
    setState(job.videoId, { progress: values.reduce((a, b) => a + b, 0) / values.length, failed: false });
  };
  report();
  try {
    // All files at once, so iOS keeps sending every one in the background.
    await Promise.all(
      job.files
        .filter((f) => !done.has(f.objectId))
        .map(async (f) => {
          await withRetries(() =>
            uploadFile(job.userId, f, (fraction) => {
              progress.set(f.objectId, fraction);
              report();
            }),
          );
          await updatePending((p) => {
            if (p[job.videoId]) p[job.videoId].done = [...(p[job.videoId].done ?? []), f.objectId];
          });
        }),
    );
    // The storage trigger has queued it by now; this is a harmless backup.
    await retryVideo(job.videoId).catch(() => {});
    await updatePending((p) => delete p[job.videoId]);
    setState(job.videoId, null);
  } catch (err) {
    console.warn(`Upload failed for ${job.videoId}`, err);
    await markUploadFailed(job.videoId, 'Upload failed. Check your connection and tap Retry.').catch(() => {});
    setState(job.videoId, { progress: 0, failed: true });
  } finally {
    running.delete(job.videoId);
  }
}

export async function enqueueUploads(jobs: UploadJob[]): Promise<void> {
  await updatePending((p) => {
    for (const job of jobs) p[job.videoId] = job;
  });
  jobs.forEach((job) => void runUpload(job));
}

/** Retries an upload from this device. Returns false if the file isn't known here. */
export async function retryUpload(videoId: string): Promise<boolean> {
  const job = (await loadPending())[videoId];
  if (!job) return false;
  void runUpload(job);
  return true;
}

export async function hasLocalUpload(videoId: string): Promise<boolean> {
  return Boolean((await loadPending())[videoId]);
}

/**
 * Restarts uploads that were cut off (app closed mid-upload) and forgets ones
 * the server already has. Call when the Batch tab opens.
 */
export async function resumePendingUploads(videos: VideoSummary[]): Promise<void> {
  const pending = await loadPending();
  const byId = new Map(videos.map((v) => [v.id, v]));
  const finished: string[] = [];
  for (const job of Object.values(pending)) {
    const video = byId.get(job.videoId);
    if (!video) continue;
    if (video.status === 'uploading' && !running.has(job.videoId)) void runUpload(job);
    else if (video.status !== 'uploading' && video.status !== 'failed') finished.push(job.videoId);
  }
  if (finished.length) await updatePending((p) => finished.forEach((id) => delete p[id]));
}

export async function pendingUploadCount(): Promise<number> {
  return Object.keys(await loadPending()).length;
}

/** Clears everything, e.g. on sign out. */
export async function clearPendingUploads(): Promise<void> {
  await updatePending((p) => Object.keys(p).forEach((id) => delete p[id]));
}
