import path from 'node:path';

import type { CostEntry } from '../costs';
import { joinWithTransition, probe, renderSegments } from '../ffmpeg';
import { finishCut, type ModeResult } from '../finish';
import { beforeAfterSegments, type Moment } from '../shots';
import { canvasFor, modeText, pushCost, stillsAt, toRanges, totalDuration, type ModeContext } from './common';

const STILLS = 8;
const TRANSITION = 0.6;

/**
 * Before & After Mode: find the "before" and "after" moments, join them with
 * a wipe, and add editable "Before" / "After" labels.
 */
export async function editBeforeAfter(ctx: ModeContext): Promise<ModeResult> {
  const started = Date.now();
  const costs: CostEntry[] = [];
  const { clips, workDir } = ctx;

  // Stills spread over all the footage, in proportion to each clip's length.
  const total = totalDuration(clips);
  const points: Moment[] = [];
  for (let i = 0; i < STILLS; i++) {
    let t = ((i + 0.5) / STILLS) * total;
    let clip = 0;
    while (clip < clips.length - 1 && t > clips[clip].probe.duration) t -= clips[clip++].probe.duration;
    points.push({ clip, time: Math.min(t, clips[clip].probe.duration - 0.05) });
  }
  const stills = await stillsAt(
    clips,
    points.map((p, i) => ({ ...p, label: `id ${i} (clip ${p.clip}, ${p.time.toFixed(1)}s)` })),
    workDir,
    'ba',
  );
  const found = await ctx.ai.findBeforeAfter(stills);
  pushCost(costs, found.cost);

  // Without the AI: the very start is "before", the very end is "after".
  const last = clips.length - 1;
  const before = found.value
    ? points[found.value.before]
    : { clip: 0, time: Math.min(1.5, clips[0].probe.duration * 0.2) };
  const after = found.value ? points[found.value.after] : { clip: last, time: clips[last].probe.duration * 0.8 };
  const segs = beforeAfterSegments(
    before,
    after,
    clips.map((c) => c.probe.duration),
  );

  const size = canvasFor(clips);
  const beforeFile = path.join(workDir, 'before.mp4');
  const afterFile = path.join(workDir, 'after.mp4');
  await renderSegments({ ranges: toRanges(clips, [segs.before]), output: beforeFile, workDir, size, tag: 'b' });
  await renderSegments({ ranges: toRanges(clips, [segs.after]), output: afterFile, workDir, size, tag: 'a' });
  const outputPath = path.join(workDir, 'cut.mp4');
  await joinWithTransition(beforeFile, afterFile, outputPath, TRANSITION);

  const finished = await finishCut({
    outputPath,
    workDir,
    transcript: [],
    suggestions: ctx.suggestions,
    costs,
    started,
  });
  // Swap labels halfway through the wipe.
  const swap = (await probe(beforeFile)).duration - TRANSITION / 2;
  const label = { font: 'montserrat-extrabold' as const, background: true, y: 0.15 };
  return {
    outputPath,
    sourceDuration: total,
    decisions: {
      mode: 'before_after',
      segments: [segs.before, segs.after],
      source: found.value ? 'ai' : 'heuristic',
    },
    transcript: [],
    costs,
    overlays: {
      version: 1,
      captions: null,
      texts: [
        modeText('Before', { ...label, start: 0, end: swap }),
        modeText('After', { ...label, start: swap, end: finished.outputDuration }),
      ],
      zooms: [],
    },
    ...finished,
  };
}
