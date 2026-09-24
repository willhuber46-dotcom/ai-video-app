import path from 'node:path';

import { TEXT_SIZES } from '@app/shared';

import { analyzeFrames } from '../analysis';
import type { CostEntry } from '../costs';
import { renderSegments } from '../ffmpeg';
import { finishCut, type ModeResult } from '../finish';
import { noTalkingTarget, pickShots, scoreWindows, usableCandidates } from '../shots';
import { aestheticText, canvasFor, pushCost, stillsAt, toRanges, totalDuration, type ModeContext } from './common';

const SHOT_SECONDS = 2;
/** Stills the AI compares; more costs more and rarely changes the pick. */
const AI_CANDIDATES = 12;

/**
 * No Talking Mode: ignore the audio, drop blurry and shaky moments, and cut
 * the best-looking shots together at a steady 2-second rhythm.
 */
export async function editNoTalking(ctx: ModeContext): Promise<ModeResult> {
  const started = Date.now();
  const costs: CostEntry[] = [];
  const { clips, workDir } = ctx;

  const analysed = [];
  for (const [i, clip] of clips.entries()) {
    analysed.push({ metrics: await analyzeFrames(clip.path, workDir, String(i)), duration: clip.probe.duration });
  }
  const candidates = usableCandidates(scoreWindows(analysed, SHOT_SECONDS));
  const target = noTalkingTarget(totalDuration(clips), SHOT_SECONDS);

  // Let the AI look at the strongest candidates and say which show the product best.
  const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, AI_CANDIDATES);
  const stills = await stillsAt(
    clips,
    top.map((c) => ({ clip: c.clip, time: (c.start + c.end) / 2, label: `id ${c.id}` })),
    workDir,
    'shot',
  );
  const ranked = await ctx.ai.rankShots(
    stills.map((s, i) => ({ ...s, id: top[i].id })),
    Math.ceil(target / SHOT_SECONDS),
  );
  pushCost(costs, ranked.cost);

  const shots = pickShots(candidates, { targetSeconds: target, preferred: ranked.value ?? undefined });
  const outputPath = path.join(workDir, 'cut.mp4');
  await renderSegments({
    ranges: toRanges(clips, shots),
    output: outputPath,
    workDir,
    size: canvasFor(clips),
    audio: 'silent',
  });

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
    decisions: { mode: 'no_talking', segments: shots, source: ranked.value ? 'ai' : 'heuristic' },
    transcript: [],
    costs,
    overlays: aestheticText(finished.suggestions, finished.outputDuration, {
      font: 'playfair-bold',
      size: TEXT_SIZES[1].value,
    }),
    ...finished,
  };
}
