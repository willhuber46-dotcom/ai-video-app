import path from 'node:path';

import { MAX_INPUT_SECONDS, type EditDecisions, type Pacing, type WordTiming } from '@app/shared';

import { computeCost, type CostEntry } from './costs';
import { computeSilenceEdit, computeTalkingEdit, remapWords, splitSentences } from './cuts';
import { detectSilences, extractAudio, makeThumbnail, probe, renderKeepRanges } from './ffmpeg';
import type { RetakeDetector } from './retakes';
import type { Transcriber } from './transcribe';

/** An error whose message is safe and helpful to show in the app. */
export class UserFacingError extends Error {}

export type TalkingEditResult = {
  outputPath: string;
  thumbnailPath: string;
  sourceDuration: number;
  outputDuration: number;
  decisions: EditDecisions;
  /** Kept words on the edited video's timeline, for captions. */
  transcript: WordTiming[];
  costs: CostEntry[];
};

/**
 * Talking Mode: transcribe, drop fillers/retakes/dead air, render. Works on
 * local files only so it can run from the worker or the CLI.
 */
export async function editTalkingVideo(opts: {
  inputPath: string;
  workDir: string;
  pacing: Pacing;
  language: string;
  transcriber: Transcriber;
  retakes: RetakeDetector;
}): Promise<TalkingEditResult> {
  const started = Date.now();
  const costs: CostEntry[] = [];

  const source = await probe(opts.inputPath);
  if (!source.hasVideo) throw new UserFacingError("This file doesn't have any video in it.");
  if (!source.hasAudio) {
    throw new UserFacingError("This video has no sound. Talking Mode needs you to be speaking. Try another mode.");
  }
  if (source.duration > MAX_INPUT_SECONDS + 5) {
    throw new UserFacingError('Videos can be up to 10 minutes long. Trim this one and try again.');
  }

  const audioPath = path.join(opts.workDir, 'audio.flac');
  await extractAudio(opts.inputPath, audioPath);
  const { words, cost: transcriptionCost } = await opts.transcriber.transcribe(audioPath, opts.language);
  costs.push(transcriptionCost);

  let decisions: EditDecisions;
  let transcript: WordTiming[] = [];

  if (words.length > 0) {
    const sentences = splitSentences(words);
    const retakes = await opts.retakes.detect(sentences, words);
    if (retakes.cost) costs.push(retakes.cost);
    const edit = computeTalkingEdit({
      words,
      duration: source.duration,
      pacing: opts.pacing,
      retakeSentences: retakes.drop,
      retakeSource: retakes.source,
    });
    decisions = edit.decisions;
    transcript = remapWords(words, edit.keptWordIndices, decisions.keep);
  } else {
    // No words recognised (e.g. very quiet or non-speech audio): cut on silence instead.
    const silences = await detectSilences(opts.inputPath);
    decisions = computeSilenceEdit(silences, source.duration, opts.pacing);
  }

  if (decisions.keep.length === 0) {
    throw new UserFacingError("We couldn't find any speech in this video.");
  }

  const outputPath = path.join(opts.workDir, 'cut.mp4');
  await renderKeepRanges({ input: opts.inputPath, keep: decisions.keep, output: outputPath, workDir: opts.workDir, source });
  const output = await probe(outputPath);

  const thumbnailPath = path.join(opts.workDir, 'thumb.jpg');
  await makeThumbnail(outputPath, thumbnailPath, Math.min(1, output.duration / 3));

  costs.push(computeCost((Date.now() - started) / 1000));

  return {
    outputPath,
    thumbnailPath,
    sourceDuration: source.duration,
    outputDuration: output.duration,
    decisions,
    transcript,
    costs,
  };
}
