import path from 'node:path';

import type { EditMode } from '@app/shared';

import { renderSegments } from '../ffmpeg';
import type { ModeResult } from '../finish';
import { editTalkingVideo } from '../talking';
import { editBeforeAfter } from './before-after';
import { canvasFor, loadClips, totalDuration, type ModeContext } from './common';
import { editNoTalking } from './no-talking';
import { editUnboxing } from './unboxing';
import { editVoiceover } from './voiceover';

export type EditInput = Omit<ModeContext, 'clips'> & { clipPaths: string[] };

/** Runs the right mode for a video's clips. */
export async function editVideo(mode: EditMode, input: EditInput): Promise<ModeResult> {
  const clips = await loadClips(input.clipPaths);
  const ctx: ModeContext = { ...input, clips };

  switch (mode) {
    case 'talking': {
      // Several clips of talking: join them first, then cut as one recording.
      let inputPath = clips[0].path;
      if (clips.length > 1) {
        inputPath = path.join(input.workDir, 'joined.mp4');
        await renderSegments({
          ranges: clips.map((c) => ({ input: c.path, source: c.probe, start: 0, end: c.probe.duration })),
          output: inputPath,
          workDir: input.workDir,
          size: canvasFor(clips),
          tag: 'join',
        });
      }
      const result = await editTalkingVideo({ ...input, inputPath });
      return { ...result, sourceDuration: totalDuration(clips) };
    }
    case 'no_talking':
      return editNoTalking(ctx);
    case 'voiceover':
      return editVoiceover(ctx);
    case 'before_after':
      return editBeforeAfter(ctx);
    case 'unboxing_asmr':
      return editUnboxing(ctx);
  }
}
