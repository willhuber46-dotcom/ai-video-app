import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Word } from '../src/cuts';
import { probe } from '../src/ffmpeg';
import { HeuristicRetakeDetector } from '../src/retakes';
import { HeuristicSuggestionGenerator } from '../src/suggestions';
import { editTalkingVideo, UserFacingError } from '../src/talking';
import type { Transcriber } from '../src/transcribe';

/** Returns a fixed transcript instead of calling Deepgram. */
class FakeTranscriber implements Transcriber {
  constructor(private words: Word[]) {}
  async transcribe() {
    return {
      words: this.words,
      cost: { kind: 'transcription' as const, provider: 'fake', units: 0, unit: 'audio_minute', usd: 0 },
    };
  }
}

const w = (word: string, start: number, end: number): Word => ({ word: word.toLowerCase().replace(/\W/g, ''), punctuated: word, start, end });

let dir: string;
let input: string;
let silentInput: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'talking-e2e-'));
  input = path.join(dir, 'raw.mp4');
  silentInput = path.join(dir, 'silent.mp4');
  // 12s vertical 1080x1920 test video at 30fps with a tone for audio.
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input,
  ]);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', silentInput,
  ]);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('editTalkingVideo', () => {
  it('cuts dead air, fillers and retakes into a playable MP4', async () => {
    const words: Word[] = [
      // A retake of the first line: dropped by the heuristic.
      w('This', 1.0, 1.3), w('sweater', 1.3, 1.7), w('is', 1.7, 1.9), w('so', 1.9, 2.1), w('soft.', 2.1, 2.6),
      // 2.4s of dead air, then the good take.
      w('This', 5.0, 5.3), w('sweater', 5.3, 5.7), w('is', 5.7, 5.9), w('so', 5.9, 6.1), w('soft.', 6.1, 6.6),
      w('Um', 6.8, 7.2),
      w('Grab', 7.5, 7.8), w('it', 7.8, 8.0), w('today.', 8.0, 8.5),
    ];
    const workDir = await mkdtemp(path.join(dir, 'job-'));
    const result = await editTalkingVideo({
      inputPath: input,
      workDir,
      pacing: 'tight',
      language: 'en',
      transcriber: new FakeTranscriber(words),
      retakes: new HeuristicRetakeDetector(),
      suggestions: new HeuristicSuggestionGenerator(),
    });

    expect(result.decisions.retakeSource).toBe('heuristic');
    expect(result.decisions.removed.retakeSentences).toBe(1);
    expect(result.decisions.removed.fillerWords).toBe(1);
    expect(result.decisions.keep).toEqual([
      { start: 4.92, end: 6.68 },
      { start: 7.42, end: 8.58 },
    ]);

    const expected = result.decisions.keep.reduce((s, r) => s + r.end - r.start, 0);
    const out = await probe(result.outputPath);
    expect(out.hasVideo).toBe(true);
    expect(out.hasAudio).toBe(true);
    expect(out.duration).toBeGreaterThan(expected - 0.15);
    expect(out.duration).toBeLessThan(expected + 0.15);
    expect(result.sourceDuration).toBeCloseTo(12, 0);
    expect((await stat(result.thumbnailPath)).size).toBeGreaterThan(0);
    expect([result.outputWidth, result.outputHeight]).toEqual([1080, 1920]);

    // Without the AI, zoom suggestions still come from sentence starts.
    expect(result.suggestions.source).toBe('heuristic');
    expect(result.suggestions.zooms[0]).toMatchObject({ start: 0.08, scale: 1.3, x: 0.5, y: 0.45 });

    // Captions line up with the edited timeline.
    expect(result.transcript[0]).toEqual({ word: 'This', start: 0.08, end: 0.38 });
    expect(result.transcript.map((t) => t.word)).toEqual(['This', 'sweater', 'is', 'so', 'soft.', 'Grab', 'it', 'today.']);

    // Output is capped at 1080x1920.
    const dims = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', result.outputPath,
    ]).toString().trim();
    expect(dims).toBe('1080,1920');
  }, 120_000);

  it('rejects video without sound with a friendly message', async () => {
    const workDir = await mkdtemp(path.join(dir, 'job-'));
    await expect(
      editTalkingVideo({
        inputPath: silentInput,
        workDir,
        pacing: 'natural',
        language: 'en',
        transcriber: new FakeTranscriber([]),
        retakes: new HeuristicRetakeDetector(),
      suggestions: new HeuristicSuggestionGenerator(),
      }),
    ).rejects.toBeInstanceOf(UserFacingError);
  }, 60_000);
});
