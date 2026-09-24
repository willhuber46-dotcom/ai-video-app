import path from 'node:path';

import type { AiSuggestions, ClipDecisions, EditDecisions, OverlayDoc, WordTiming } from '@app/shared';

import { computeCost, type CostEntry } from './costs';
import { extractFrames, makeThumbnail, probe } from './ffmpeg';
import type { SuggestionGenerator } from './suggestions';

/** What every mode hands back to the job runner. */
export type ModeResult = {
  outputPath: string;
  thumbnailPath: string;
  sourceDuration: number;
  outputDuration: number;
  outputWidth: number;
  outputHeight: number;
  decisions: EditDecisions | ClipDecisions;
  /** Kept words on the edited video's timeline, for captions. */
  transcript: WordTiming[];
  /** Text and zoom ideas for the editing tools. */
  suggestions: AiSuggestions;
  /** On-screen text the mode adds up front (e.g. Before/After labels); always editable. */
  overlays?: OverlayDoc;
  costs: CostEntry[];
};

/** Number of stills the AI looks at: one per ~5s, between 2 and 6. */
function frameTimes(duration: number): number[] {
  const count = Math.min(6, Math.max(2, Math.round(duration / 5)));
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count);
}

/** Thumbnail, AI suggestions and compute cost for a rendered cut. */
export async function finishCut(opts: {
  outputPath: string;
  workDir: string;
  transcript: WordTiming[];
  suggestions: SuggestionGenerator;
  costs: CostEntry[];
  started: number;
}): Promise<Pick<ModeResult, 'thumbnailPath' | 'outputDuration' | 'outputWidth' | 'outputHeight' | 'suggestions'>> {
  const output = await probe(opts.outputPath);
  const thumbnailPath = path.join(opts.workDir, 'thumb.jpg');
  await makeThumbnail(opts.outputPath, thumbnailPath, Math.min(1, output.duration / 3));

  const times = frameTimes(output.duration);
  const framePaths = await extractFrames(opts.outputPath, times, opts.workDir);
  const { suggestions, cost } = await opts.suggestions.suggest({
    transcript: opts.transcript,
    duration: output.duration,
    frames: framePaths.map((p, i) => ({ path: p, time: times[i] })),
  });
  if (cost) opts.costs.push(cost);
  opts.costs.push(computeCost((Date.now() - opts.started) / 1000));

  return {
    thumbnailPath,
    outputDuration: output.duration,
    outputWidth: output.width,
    outputHeight: output.height,
    suggestions,
  };
}
