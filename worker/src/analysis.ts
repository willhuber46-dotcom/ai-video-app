import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { FFMPEG, run } from './ffmpeg';

/**
 * Cheap signal analysis for the non-talking modes. Frames are decoded tiny and
 * grayscale; audio is decoded mono at 8 kHz. The scoring functions are pure.
 */

export const FRAME_W = 64;
export const FRAME_H = 112;
export const FRAME_FPS = 4;

export type FrameMetrics = {
  fps: number;
  /** Variance of the Laplacian per frame: higher is sharper. */
  sharpness: number[];
  /** Mean absolute pixel change from the previous frame (0-255): camera or subject movement. */
  motion: number[];
};

export function frameMetrics(gray: Uint8Array, width: number, height: number, fps: number): FrameMetrics {
  const size = width * height;
  const count = Math.floor(gray.length / size);
  const sharpness: number[] = [];
  const motion: number[] = [];
  for (let f = 0; f < count; f++) {
    const o = f * size;
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = o + y * width + x;
        const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    sharpness.push(n ? sumSq / n - (sum / n) ** 2 : 0);

    if (f === 0) motion.push(0);
    else {
      let diff = 0;
      for (let i = 0; i < size; i++) diff += Math.abs(gray[o + i] - gray[o - size + i]);
      motion.push(diff / size);
    }
  }
  return { fps, sharpness, motion };
}

export async function analyzeFrames(file: string, workDir: string, tag: string): Promise<FrameMetrics> {
  const out = path.join(workDir, `frames-${tag}.gray`);
  await run(FFMPEG, [
    '-y',
    '-i',
    file,
    '-vf',
    `fps=${FRAME_FPS},scale=${FRAME_W}:${FRAME_H},format=gray`,
    '-f',
    'rawvideo',
    out,
  ]);
  return frameMetrics(new Uint8Array(await readFile(out)), FRAME_W, FRAME_H, FRAME_FPS);
}

export const AUDIO_RATE = 8000;
export const AUDIO_WINDOW = 0.1;

export type AudioActivity = {
  /** Seconds per value. */
  window: number;
  /** Loudness per window (RMS, 0-1). */
  rms: number[];
  /** Sudden rises in loudness: taps, clicks, tearing, pouring onsets. */
  onsets: number[];
};

export function audioActivity(samples: Int16Array, rate: number, window = AUDIO_WINDOW): AudioActivity {
  const per = Math.max(1, Math.round(rate * window));
  const rms: number[] = [];
  for (let i = 0; i + per <= samples.length; i += per) {
    let sq = 0;
    for (let j = i; j < i + per; j++) sq += (samples[j] / 32768) ** 2;
    rms.push(Math.sqrt(sq / per));
  }
  const onsets = rms.map((v, i) => Math.max(0, v - (i > 0 ? rms[i - 1] : v)));
  return { window, rms, onsets };
}

export async function analyzeAudio(file: string, workDir: string, tag: string): Promise<AudioActivity> {
  const out = path.join(workDir, `audio-${tag}.pcm`);
  await run(FFMPEG, ['-y', '-i', file, '-vn', '-ac', '1', '-ar', String(AUDIO_RATE), '-f', 's16le', out]);
  const buf = await readFile(out);
  return audioActivity(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)), AUDIO_RATE);
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** Values averaged over a sliding window of `radius` entries each side. */
export function smooth(values: number[], radius: number): number[] {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - radius), i + radius + 1)));
}
