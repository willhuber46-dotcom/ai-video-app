import type { VideoStatus } from './db';

/** Videos per batch at launch. Higher plans can raise it later. */
export const BATCH_LIMIT = 10;

export type BatchSummary = {
  total: number;
  done: number;
  failed: number;
  uploading: number;
  /** Uploaded and waiting for, or in, editing. */
  editing: number;
  /** Every video is done or failed. */
  finished: boolean;
};

export function summarizeBatch(statuses: VideoStatus[]): BatchSummary {
  const count = (...s: VideoStatus[]) => statuses.filter((x) => s.includes(x)).length;
  const done = count('done');
  const failed = count('failed');
  return {
    total: statuses.length,
    done,
    failed,
    uploading: count('uploading'),
    editing: count('queued', 'editing'),
    finished: statuses.length > 0 && done + failed === statuses.length,
  };
}

/** "3 of 10 done", "All 10 done", "9 of 10 done, 1 failed". */
export function batchProgressLabel(s: BatchSummary): string {
  if (s.total === 1) return s.done ? 'Done' : s.failed ? 'Failed' : 'In progress';
  const main = s.done === s.total ? `All ${s.total} done` : `${s.done} of ${s.total} done`;
  return s.failed ? `${main}, ${s.failed} failed` : main;
}

/** Push notification text for a finished batch. */
export function batchFinishedMessage(total: number, done: number, failed: number): { title: string; body: string } {
  if (done === 0) {
    return {
      title: total === 1 ? 'Your video couldn’t be edited' : 'Your videos couldn’t be edited',
      body: 'Open the app to see what went wrong and retry.',
    };
  }
  const title =
    total === 1
      ? 'Your video is ready ✂️'
      : done === total
        ? `All ${total} videos are ready ✂️`
        : `${done} of ${total} videos are ready ✂️`;
  const body = failed
    ? `${failed} ${failed === 1 ? 'needs' : 'need'} another try. Open the app to retry.`
    : 'Tap to preview, add captions and save.';
  return { title, body };
}
