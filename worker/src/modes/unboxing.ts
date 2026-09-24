import path from 'node:path';

import { TEXT_SIZES } from '@app/shared';

import { analyzeAudio } from '../analysis';
import type { CostEntry } from '../costs';
import { renderSegments } from '../ffmpeg';
import { finishCut, type ModeResult } from '../finish';
import { activeRanges, type Segment } from '../shots';
import { aestheticText, canvasFor, toRanges, totalDuration, type ModeContext } from './common';

/**
 * Unboxing / ASMR Mode: keep the moments with satisfying sounds (tearing,
 * clicking, pouring) with their original audio, and cut slow handling.
 */
export async function editUnboxing(ctx: ModeContext): Promise<ModeResult> {
  const started = Date.now();
  const costs: CostEntry[] = [];
  const { clips, workDir } = ctx;

  const segments: Segment[] = [];
  for (const [i, clip] of clips.entries()) {
    if (!clip.probe.hasAudio) {
      // Nothing to listen to: keep the clip whole.
      segments.push({ clip: i, start: 0, end: clip.probe.duration });
      continue;
    }
    const activity = await analyzeAudio(clip.path, workDir, String(i));
    for (const r of activeRanges(activity, clip.probe.duration, ctx.pacing)) segments.push({ clip: i, ...r });
  }

  const outputPath = path.join(workDir, 'cut.mp4');
  await renderSegments({ ranges: toRanges(clips, segments), output: outputPath, workDir, size: canvasFor(clips) });

  const finished = await finishCut({
    outputPath,
    workDir,
    transcript: [],
    suggestions: ctx.suggestions,
    costs,
    started,
  });
  return {
    outputPath,
    sourceDuration: totalDuration(clips),
    decisions: { mode: 'unboxing_asmr', segments, source: 'heuristic' },
    transcript: [],
    costs,
    // "Light" text: the clean font, small.
    overlays: aestheticText(finished.suggestions, finished.outputDuration, {
      font: 'inter-semibold',
      size: TEXT_SIZES[0].value,
    }),
    ...finished,
  };
}
