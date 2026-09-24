import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ClipDecisions } from '@app/shared';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Word } from '../src/cuts';
import { probe } from '../src/ffmpeg';
import { NoModeAi } from '../src/mode-ai';
import { editVideo, type EditInput } from '../src/modes';
import { HeuristicRetakeDetector } from '../src/retakes';
import { HeuristicSuggestionGenerator } from '../src/suggestions';
import type { Transcriber } from '../src/transcribe';

class FakeTranscriber implements Transcriber {
  constructor(private words: Word[]) {}
  async transcribe() {
    return {
      words: this.words,
      cost: { kind: 'transcription' as const, provider: 'fake', units: 0, unit: 'audio_minute', usd: 0 },
    };
  }
}

let dir: string;
const ff = (...args: string[]) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args]);

/** A test clip: moving pattern (or a flat color) with optional blur and sound. */
function clip(
  name: string,
  opts: { seconds: number; size?: string; color?: string; blurUntil?: number; audio?: 'tone' | 'bursts' | 'none' },
) {
  const file = path.join(dir, name);
  const size = opts.size ?? '540x960';
  const video = opts.color
    ? `color=c=${opts.color}:size=${size}:rate=30:duration=${opts.seconds}`
    : `testsrc2=size=${size}:rate=30:duration=${opts.seconds}`;
  const args = ['-f', 'lavfi', '-i', video];
  if (opts.audio === 'tone') args.push('-f', 'lavfi', '-i', `sine=frequency=300:duration=${opts.seconds}`);
  if (opts.audio === 'bursts') {
    args.push('-f', 'lavfi', '-i', `anoisesrc=d=${opts.seconds}:c=white:a=0.6`);
  }
  const vf = opts.blurUntil ? ['-vf', `gblur=sigma=25:enable='lt(t,${opts.blurUntil})'`] : [];
  const af = opts.audio === 'bursts' ? ['-af', "volume='if(between(t,2,3)+between(t,7,8),1,0.003)':eval=frame"] : [];
  ff(
    ...args,
    ...vf,
    ...af,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    ...(opts.audio && opts.audio !== 'none' ? ['-c:a', 'aac', '-shortest'] : []),
    file,
  );
  return file;
}

function input(clipPaths: string[], extra: Partial<EditInput> = {}): EditInput {
  return {
    clipPaths,
    voicePath: null,
    workDir: dir,
    pacing: 'tight',
    language: 'en',
    transcriber: new FakeTranscriber([]),
    retakes: new HeuristicRetakeDetector(),
    suggestions: new HeuristicSuggestionGenerator(),
    ai: new NoModeAi(),
    ...extra,
  };
}

/** Average loudness in dB, from FFmpeg's volumedetect (which logs to stderr). */
function meanVolume(file: string): number {
  const log = execFileSync('sh', ['-c', `ffmpeg -i '${file}' -af volumedetect -f null - 2>&1`]).toString();
  return Number(log.match(/mean_volume: (-?[\d.]+)/)![1]);
}

async function averageColor(file: string, t: number) {
  const png = path.join(dir, `color-${path.basename(file)}-${t}.png`);
  ff('-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=32:32', png);
  const img = await loadImage(png);
  const ctx = createCanvas(32, 32).getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let r = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    b += d[i + 2];
  }
  return { r: r / 1024, b: b / 1024 };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'modes-e2e-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('No Talking Mode', () => {
  it('cuts sharp, steady shots from every clip into a silent vertical video', async () => {
    const a = clip('nt-a.mp4', { seconds: 8, audio: 'tone' });
    const b = clip('nt-b.mp4', { seconds: 8, blurUntil: 4, audio: 'tone' });
    const result = await editVideo('no_talking', input([a, b], { workDir: await mkdtemp(path.join(dir, 'nt-')) }));

    const decisions = result.decisions as ClipDecisions;
    expect(new Set(decisions.segments.map((s) => s.clip))).toEqual(new Set([0, 1]));
    // Nothing from the blurry first half of clip b.
    for (const s of decisions.segments.filter((x) => x.clip === 1)) expect(s.start).toBeGreaterThanOrEqual(4);
    const planned = decisions.segments.reduce((s, x) => s + x.end - x.start, 0);
    expect(result.outputDuration).toBeCloseTo(planned, 0);
    expect([result.outputWidth, result.outputHeight]).toEqual([1080, 1920]);
    expect(meanVolume(result.outputPath)).toBeLessThan(-80);
  }, 180_000);
});

describe('Unboxing / ASMR Mode', () => {
  it('keeps the loud, crisp moments and cuts the quiet handling', async () => {
    const a = clip('ub.mp4', { seconds: 10, audio: 'bursts' });
    const result = await editVideo('unboxing_asmr', input([a], { workDir: await mkdtemp(path.join(dir, 'ub-')) }));
    const segments = (result.decisions as ClipDecisions).segments;
    expect(segments.length).toBe(2);
    expect(segments[0].start).toBeLessThanOrEqual(2);
    expect(segments[1].end).toBeGreaterThanOrEqual(8);
    expect(result.outputDuration).toBeGreaterThan(2);
    expect(result.outputDuration).toBeLessThan(5);
    // The kept sound is the loud part.
    expect(meanVolume(result.outputPath)).toBeGreaterThan(-25);
  }, 180_000);
});

describe('Voiceover Mode', () => {
  it('lays clips under a tightened voice track and keeps the words for captions', async () => {
    const a = clip('vo-a.mp4', { seconds: 6, color: 'red' });
    const b = clip('vo-b.mp4', { seconds: 6, color: 'blue' });
    const voice = path.join(dir, 'voice.m4a');
    ff('-f', 'lavfi', '-i', 'sine=frequency=500:duration=9', '-c:a', 'aac', voice);
    const w = (word: string, start: number): Word => ({
      word: word.toLowerCase().replace(/\W/g, ''),
      punctuated: word,
      start,
      end: start + 0.4,
    });
    // Two lines with a 3-second pause between them.
    const words = [w('This', 0.5), w('bag', 0.9), w('rocks.', 1.3), w('Grab', 5.0), w('it', 5.4), w('now.', 5.8)];

    const result = await editVideo(
      'voiceover',
      input([a, b], {
        voicePath: voice,
        transcriber: new FakeTranscriber(words),
        workDir: await mkdtemp(path.join(dir, 'vo-')),
      }),
    );

    // Pause cut: 0.42-1.78 and 4.92-6.28 with tight padding, about 2.7s of voice.
    expect(result.outputDuration).toBeGreaterThan(2.4);
    expect(result.outputDuration).toBeLessThan(3.2);
    expect(result.transcript.map((t) => t.word)).toEqual(['This', 'bag', 'rocks.', 'Grab', 'it', 'now.']);
    const segments = (result.decisions as ClipDecisions).segments;
    expect(new Set(segments.map((s) => s.clip))).toEqual(new Set([0, 1]));
    // First line shows clip 0 (red), second line clip 1 (blue).
    expect((await averageColor(result.outputPath, 0.3)).r).toBeGreaterThan(150);
    expect((await averageColor(result.outputPath, result.outputDuration - 0.3)).b).toBeGreaterThan(150);
    expect(meanVolume(result.outputPath)).toBeGreaterThan(-40);
  }, 180_000);
});

describe('Before & After Mode', () => {
  it('wipes from the before clip to the after clip with editable labels', async () => {
    const a = clip('ba-a.mp4', { seconds: 6, color: 'red', audio: 'tone' });
    const b = clip('ba-b.mp4', { seconds: 6, color: 'blue', audio: 'tone' });
    const result = await editVideo('before_after', input([a, b], { workDir: await mkdtemp(path.join(dir, 'ba-')) }));

    expect(result.outputDuration).toBeCloseTo(2.5 + 3.5 - 0.6, 0);
    expect((await averageColor(result.outputPath, 0.5)).r).toBeGreaterThan(150);
    expect((await averageColor(result.outputPath, result.outputDuration - 0.3)).b).toBeGreaterThan(150);
    const labels = result.overlays!.texts;
    expect(labels.map((t) => t.text)).toEqual(['Before', 'After']);
    expect(labels[0].end).toBeCloseTo(2.2, 1);
    expect(labels[1].start).toBe(labels[0].end);
    const out = await probe(result.outputPath);
    expect(out.hasAudio).toBe(true);
  }, 180_000);
});
