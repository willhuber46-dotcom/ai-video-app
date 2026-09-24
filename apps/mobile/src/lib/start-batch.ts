import { MAX_INPUT_SECONDS } from '@app/shared';

import { draftDuration, type Draft } from '@/lib/drafts';
import { registerForPushNotifications } from '@/lib/notifications';
import { enqueueUploads } from '@/lib/upload-queue';
import { createBatch, type VideoSummary } from '@/lib/videos';

/** Why these drafts can't be edited yet, or null if they're ready. */
export function draftProblem(drafts: Draft[]): { title: string; message: string } | null {
  const missingVoice = drafts.findIndex((d) => d.mode === 'voiceover' && !d.voice);
  if (missingVoice >= 0) {
    return {
      title: 'Add your voice',
      message: `Video ${missingVoice + 1} is in Voiceover Mode. Record or choose a voice recording.`,
    };
  }
  const tooLong = drafts.findIndex((d) => (draftDuration(d) ?? 0) > MAX_INPUT_SECONDS + 1);
  if (tooLong >= 0) {
    return {
      title: 'Too long',
      message: `Video ${tooLong + 1}'s clips add up to more than 10 minutes. Remove some clips.`,
    };
  }
  return null;
}

/** Creates the batch and starts every upload. Returns the new video rows. */
export async function startBatch(drafts: Draft[]): Promise<VideoSummary[]> {
  // Ask once, at the moment it's useful: so we can say when the batch is done.
  void registerForPushNotifications({ prompt: true });
  const created = await createBatch(
    drafts.map((d) => ({
      clips: d.clips,
      voice: d.mode === 'voiceover' ? d.voice : null,
      mode: d.mode,
      pacing: d.pacing,
    })),
  );
  await enqueueUploads(created.map((c) => ({ videoId: c.row.id, userId: c.row.user_id, files: c.files })));
  return created.map((c) => c.row);
}
