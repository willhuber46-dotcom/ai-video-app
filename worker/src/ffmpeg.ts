import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { KeepRange } from '@app/shared';

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      // Keep memory bounded on long encodes; the tail has the useful error.
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

export type ProbeResult = {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  fps: number;
  width: number;
  height: number;
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,avg_frame_rate,width,height',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; avg_frame_rate?: string; width?: number; height?: number }[];
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const [num, den] = (video?.avg_frame_rate ?? '30/1').split('/').map(Number);
  const fps = den ? num / den : 30;
  return {
    duration: Number(data.format?.duration ?? 0),
    hasVideo: Boolean(video),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
  };
}

/** Mono 16 kHz FLAC: small to upload and all speech-to-text needs. */
export async function extractAudio(input: string, output: string): Promise<void> {
  await run(FFMPEG, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'flac', output]);
}

export async function detectSilences(input: string, noiseDb = -35, minSeconds = 0.4): Promise<KeepRange[]> {
  const { stderr } = await run(FFMPEG, [
    '-i', input,
    '-vn',
    '-af', `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`,
    '-f', 'null', '-',
  ]);
  const silences: KeepRange[] = [];
  let start: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end: ([\d.]+)/);
    if (e && start !== null) {
      silences.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  if (start !== null) silences.push({ start, end: Number.POSITIVE_INFINITY });
  return silences;
}

/** Output frame rate: the source rate, snapped to 30 or 60. */
function outputFps(sourceFps: number): number {
  return sourceFps > 45 ? 60 : 30;
}

// Longest side capped at 1920 (1080x1920 for vertical video), even dimensions.
const SCALE =
  "scale='trunc(min(1\\,1920/max(iw\\,ih))*iw/2)*2':'trunc(min(1\\,1920/max(iw\\,ih))*ih/2)*2',setsar=1";

const FADE_SECONDS = 0.012;

/** Where a segment comes from: a range of one input file. */
export type SourceRange = { input: string; source: ProbeResult; start: number; end: number };

/**
 * Renders ranges (from one or several inputs) into one MP4. Each range is
 * encoded on its own with identical settings, so timestamps stay correct even
 * for variable-frame-rate phone video, then the pieces are joined without
 * re-encoding.
 *
 * - `size`: fill a fixed frame (e.g. 1080x1920), cropping the edges, so clips
 *   filmed differently still match. Without it, the source size is kept.
 * - `audio: 'silent'` replaces the sound with silence (No Talking, Voiceover).
 */
export async function renderSegments(opts: {
  ranges: SourceRange[];
  output: string;
  workDir: string;
  size?: { width: number; height: number };
  audio?: 'keep' | 'silent';
  /** Prefix for the temporary segment files. */
  tag?: string;
}): Promise<void> {
  const { ranges, output, workDir, size, audio = 'keep', tag = 'seg' } = opts;
  if (ranges.length === 0) throw new Error('Nothing to render');
  const fps = outputFps(Math.max(...ranges.map((r) => r.source.fps)));
  const scale = size
    ? `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase,crop=${size.width}:${size.height},setsar=1`
    : SCALE;

  const files = ranges.map((_, i) => path.join(workDir, `${tag}-${String(i).padStart(4, '0')}.mp4`));

  const encode = (range: SourceRange, out: string) => {
    const d = Math.max(0.05, range.end - range.start);
    const fadeOutAt = Math.max(0, d - FADE_SECONDS);
    const useSource = audio === 'keep' && range.source.hasAudio;
    const args = ['-y', '-ss', range.start.toFixed(3), '-t', d.toFixed(3), '-i', range.input];
    if (!useSource) args.push('-f', 'lavfi', '-t', d.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo');
    args.push(
      '-map', '0:v:0',
      '-map', useSource ? '0:a:0' : '1:a:0',
      '-vf', scale,
      // Tiny fades stop audible clicks at every cut.
      '-af', `afade=t=in:d=${FADE_SECONDS},afade=t=out:st=${fadeOutAt.toFixed(3)}:d=${FADE_SECONDS}`,
      '-fps_mode', 'cfr', '-r', String(fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-video_track_timescale', '90000',
      '-shortest',
      out,
    );
    return run(FFMPEG, args);
  };

  // x264 is already multi-threaded; two at a time keeps the CPU busy between segments.
  const CONCURRENCY = 2;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, async () => {
      while (next < ranges.length) {
        const i = next++;
        await encode(ranges[i], files[i]);
      }
    }),
  );

  const listFile = path.join(workDir, `${tag}-list.txt`);
  await writeFile(listFile, files.map((s) => `file '${path.resolve(s)}'`).join('\n'));
  await run(FFMPEG, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', output]);
}

/** Talking Mode: kept ranges of a single input. */
export async function renderKeepRanges(opts: {
  input: string;
  keep: KeepRange[];
  output: string;
  workDir: string;
  source: ProbeResult;
}): Promise<void> {
  await renderSegments({
    ranges: opts.keep.map((r) => ({ input: opts.input, source: opts.source, start: r.start, end: r.end })),
    output: opts.output,
    workDir: opts.workDir,
  });
}

/** Joins two rendered pieces with a wipe (video) and crossfade (audio). */
export async function joinWithTransition(a: string, b: string, output: string, seconds = 0.6): Promise<void> {
  const first = await probe(a);
  const offset = Math.max(0, first.duration - seconds);
  await run(FFMPEG, [
    '-y', '-i', a, '-i', b,
    '-filter_complex',
    `[0:v][1:v]xfade=transition=wipeleft:duration=${seconds}:offset=${offset.toFixed(3)},format=yuv420p[v];` +
      `[0:a][1:a]acrossfade=d=${seconds}[a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ]);
}

/** Replaces a video's sound with an audio file (Voiceover). */
export async function replaceAudio(video: string, audio: string, output: string): Promise<void> {
  await run(FFMPEG, [
    '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    '-shortest', '-movflags', '+faststart',
    output,
  ]);
}

/** Cuts an audio file down to the kept ranges, with tiny fades at each join (Voiceover). */
export async function renderAudioRanges(input: string, keep: KeepRange[], output: string, workDir: string): Promise<void> {
  if (keep.length === 0) throw new Error('Nothing to render');
  const parts = keep.map(
    (r, i) =>
      `[0:a]atrim=start=${r.start.toFixed(3)}:end=${r.end.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `afade=t=in:d=${FADE_SECONDS},afade=t=out:st=${Math.max(0, r.end - r.start - FADE_SECONDS).toFixed(3)}:d=${FADE_SECONDS}[a${i}]`,
  );
  const script = path.join(workDir, 'voice-filters.txt');
  await writeFile(script, `${parts.join(';\n')};\n${keep.map((_, i) => `[a${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[out]`);
  await run(FFMPEG, ['-y', '-i', input, '-filter_complex_script', script, '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output]);
}

/** Small JPEG stills at the given times, for the AI to look at. */
export async function extractFrames(video: string, times: number[], workDir: string, prefix = 'frame'): Promise<string[]> {
  const files: string[] = [];
  for (const [i, t] of times.entries()) {
    const out = path.join(workDir, `${prefix}-${i}.jpg`);
    await run(FFMPEG, ['-y', '-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=384:-2', '-q:v', '5', out]);
    files.push(out);
  }
  return files;
}

export async function makeThumbnail(video: string, output: string, atSeconds: number): Promise<void> {
  await run(FFMPEG, ['-y', '-ss', atSeconds.toFixed(3), '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', output]);
}
