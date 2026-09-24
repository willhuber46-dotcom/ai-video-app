import path from 'node:path';

import { MAX_INPUT_SECONDS, type WordTiming } from '@app/shared';

import type { CostEntry } from '../costs';
import { computeTalkingEdit, remapWords, splitSentences } from '../cuts';
import { extractAudio, probe, renderAudioRanges, renderSegments, replaceAudio } from '../ffmpeg';
import { finishCut, type ModeResult } from '../finish';
import { planVoiceoverShots, voiceSpans } from '../shots';
import { UserFacingError } from '../talking';
import { canvasFor, pushCost, stillsAt, toRanges, totalDuration, type ModeContext } from './common';

/**
 * Voiceover Mode: clean up the voice recording like Talking Mode (pauses,
 * fillers, retakes), then place the clip that best fits each line under it.
 */
export async function editVoiceover(ctx: ModeContext): Promise<ModeResult> {
  const started = Date.now();
  const costs: CostEntry[] = [];
  const { clips, workDir } = ctx;
  if (!ctx.voicePath)
    throw new UserFacingError('Voiceover Mode needs a voice recording. Record or add one and try again.');

  const voice = await probe(ctx.voicePath);
  if (!voice.hasAudio) throw new UserFacingError('The voice recording has no sound in it.');
  if (voice.duration > MAX_INPUT_SECONDS + 5) {
    throw new UserFacingError('Voice recordings can be up to 10 minutes long.');
  }

  // 1. Transcribe and tighten the voice track.
  const flac = path.join(workDir, 'voice.flac');
  await extractAudio(ctx.voicePath, flac);
  const { words, cost: transcriptionCost } = await ctx.transcriber.transcribe(flac, ctx.language);
  costs.push(transcriptionCost);

  let voiceTrack = flac;
  let voiceDuration = voice.duration;
  let transcript: WordTiming[] = [];
  if (words.length > 0) {
    const retakes = await ctx.retakes.detect(splitSentences(words), words);
    pushCost(costs, retakes.cost);
    const edit = computeTalkingEdit({
      words,
      duration: voice.duration,
      pacing: ctx.pacing,
      retakeSentences: retakes.drop,
      retakeSource: retakes.source,
    });
    if (edit.decisions.keep.length > 0) {
      voiceTrack = path.join(workDir, 'voice-edited.wav');
      await renderAudioRanges(flac, edit.decisions.keep, voiceTrack, workDir);
      voiceDuration = edit.decisions.keep.reduce((s, r) => s + r.end - r.start, 0);
      transcript = remapWords(words, edit.keptWordIndices, edit.decisions.keep);
    }
  }

  // 2. One span of footage per line of the (edited) voice.
  const spans = voiceSpans(
    splitSentences(transcript.map((w) => ({ ...w, punctuated: w.word }))).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    })),
    voiceDuration,
  );

  // 3. Which clip fits each line: the AI looks at two stills per clip.
  const stills = await stillsAt(
    clips,
    clips.flatMap((c, i) => [1 / 3, 2 / 3].map((f) => ({ clip: i, time: c.probe.duration * f, label: `Clip ${i}` }))),
    workDir,
    'clip',
  );
  const match = await ctx.ai.matchClips(
    clips.map((_, i) => stills.filter((s) => s.label === `Clip ${i}`)),
    spans.map((s) => s.text),
  );
  pushCost(costs, match.cost);
  const assignment = match.value ?? spans.map((_, i) => i % clips.length);

  const segments = planVoiceoverShots(
    spans,
    clips.map((c) => c.probe.duration),
    assignment,
  );

  // 4. Silent footage, then the voice on top.
  const footage = path.join(workDir, 'footage.mp4');
  await renderSegments({
    ranges: toRanges(clips, segments),
    output: footage,
    workDir,
    size: canvasFor(clips) ?? undefined,
    audio: 'silent',
  });
  const outputPath = path.join(workDir, 'cut.mp4');
  await replaceAudio(footage, voiceTrack, outputPath);

  const finished = await finishCut({ outputPath, workDir, transcript, suggestions: ctx.suggestions, costs, started });
  return {
    outputPath,
    sourceDuration: totalDuration(clips) + voice.duration,
    decisions: { mode: 'voiceover', segments, source: match.value ? 'ai' : 'heuristic' },
    transcript,
    costs,
    ...finished,
  };
}
