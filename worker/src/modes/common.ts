import path from 'node:path';

import {
  MAX_INPUT_SECONDS,
  newId,
  TEXT_SIZES,
  type AiSuggestions,
  type FontKey,
  type OverlayDoc,
  type Pacing,
  type TextOverlay,
} from '@app/shared';

import type { CostEntry } from '../costs';
import { extractFrames, probe, type ProbeResult, type SourceRange } from '../ffmpeg';
import type { ModeAi, Still } from '../mode-ai';
import type { RetakeDetector } from '../retakes';
import type { Segment } from '../shots';
import type { SuggestionGenerator } from '../suggestions';
import { UserFacingError } from '../talking';
import type { Transcriber } from '../transcribe';

export type Clip = { path: string; probe: ProbeResult };

export type ModeContext = {
  /** Input clips in the order the user added them. */
  clips: Clip[];
  /** Voice recording (Voiceover Mode only). */
  voicePath: string | null;
  workDir: string;
  pacing: Pacing;
  language: string;
  transcriber: Transcriber;
  retakes: RetakeDetector;
  suggestions: SuggestionGenerator;
  ai: ModeAi;
};

export async function loadClips(paths: string[]): Promise<Clip[]> {
  const clips: Clip[] = [];
  for (const p of paths) {
    const info = await probe(p);
    if (!info.hasVideo) throw new UserFacingError('One of the clips doesn’t have any video in it.');
    clips.push({ path: p, probe: info });
  }
  const total = clips.reduce((s, c) => s + c.probe.duration, 0);
  if (total > MAX_INPUT_SECONDS + 5) {
    throw new UserFacingError('Clips can add up to 10 minutes per video. Remove some and try again.');
  }
  return clips;
}

export function totalDuration(clips: Clip[]): number {
  return clips.reduce((s, c) => s + c.probe.duration, 0);
}

/**
 * The frame combined clips are fitted to: vertical 1080x1920 unless most of
 * the footage is landscape. A single clip keeps its own shape.
 */
export function canvasFor(clips: Clip[]): { width: number; height: number } | undefined {
  if (clips.length < 2) return undefined;
  const landscape = clips.filter((c) => c.probe.width > c.probe.height).length;
  return landscape > clips.length / 2 ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

export function toRanges(clips: Clip[], segments: Segment[]): SourceRange[] {
  return segments.map((s) => ({ input: clips[s.clip].path, source: clips[s.clip].probe, start: s.start, end: s.end }));
}

/** JPEG stills at (clip, time) points, labelled for the AI. */
export async function stillsAt(
  clips: Clip[],
  points: { clip: number; time: number; label: string }[],
  workDir: string,
  tag: string,
): Promise<Still[]> {
  const stills: Still[] = [];
  for (const [i, p] of points.entries()) {
    const [file] = await extractFrames(clips[p.clip].path, [p.time], workDir, `${tag}-${i}`);
    stills.push({ id: i, path: file, label: p.label });
  }
  return stills;
}

export function pushCost(costs: CostEntry[], cost: CostEntry | undefined) {
  if (cost) costs.push(cost);
}

/** An on-screen text overlay the mode adds; the user can edit or remove it. */
export function modeText(
  text: string,
  opts: { start: number; end: number; font?: FontKey; size?: number; y?: number; background?: boolean; color?: string },
): TextOverlay {
  return {
    id: newId(),
    text,
    font: opts.font ?? 'montserrat-extrabold',
    color: opts.color ?? '#FFFFFF',
    background: opts.background ?? false,
    x: 0.5,
    y: opts.y ?? 0.2,
    size: opts.size ?? TEXT_SIZES[1].value,
    start: opts.start,
    end: opts.end,
  };
}

/** Aesthetic text from the AI's top hook, lowercase for the soft look. */
export function aestheticText(
  suggestions: AiSuggestions,
  duration: number,
  style: { font: FontKey; size: number },
): OverlayDoc | undefined {
  const top = suggestions.texts[0];
  if (!top) return undefined;
  const text = `${top.text.toLowerCase()}${top.emoji ? ` ${top.emoji}` : ''}`;
  return {
    version: 1,
    captions: null,
    texts: [modeText(text, { start: 0, end: duration, font: style.font, size: style.size, y: 0.18 })],
    zooms: [],
  };
}
