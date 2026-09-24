import type { Pacing } from '@app/shared';

import { mean, percentile, smooth, type AudioActivity, type FrameMetrics } from './analysis';
import { mergeRanges, PACING_PARAMS } from './cuts';

/** A piece of one input clip, in seconds. */
export type Segment = { clip: number; start: number; end: number };

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// No Talking: best-looking shots at a steady rhythm
// ---------------------------------------------------------------------------

export type Candidate = Segment & {
  id: number;
  sharpness: number;
  motion: number;
  maxMotion: number;
  score: number;
};

/** Mean frame motion above this looks shaky (on 64x112 grayscale frames). */
const SHAKY_MEAN = 18;
const SHAKY_PEAK = 32;
const STEP = 0.5;

/** Every window of `shotLength` seconds in every clip, with quality scores. */
export function scoreWindows(clips: { metrics: FrameMetrics; duration: number }[], shotLength: number): Candidate[] {
  const raw: Omit<Candidate, 'id' | 'score'>[] = [];
  clips.forEach(({ metrics, duration }, clip) => {
    const len = Math.min(shotLength, duration);
    for (let start = 0; start + len <= duration + 1e-6; start += STEP) {
      const a = Math.floor(start * metrics.fps);
      const b = Math.max(a + 1, Math.ceil((start + len) * metrics.fps));
      const sharp = metrics.sharpness.slice(a, b);
      // The first motion value compares against nothing; skip it.
      const move = metrics.motion.slice(Math.max(a, 1), b);
      raw.push({
        clip,
        start: round(start),
        end: round(start + len),
        // A low percentile, so a shot that goes soft for a moment counts as blurry.
        sharpness: percentile(sharp, 0.25),
        motion: mean(move),
        maxMotion: move.length ? Math.max(...move) : 0,
      });
      if (len < shotLength) break;
    }
  });
  const ref = percentile(
    raw.map((c) => c.sharpness),
    0.9,
  );
  return raw.map((c, id) => ({
    ...c,
    id,
    // Sharp first; a little movement (turns, reveals) beats a static frame.
    score: Math.min(1, c.sharpness / (ref || 1)) + 0.3 * Math.min(1, c.motion / 6),
  }));
}

/** Drops blurry and shaky windows. Falls back to everything if nothing survives. */
export function usableCandidates(candidates: Candidate[]): Candidate[] {
  const blurLine =
    0.35 *
    percentile(
      candidates.map((c) => c.sharpness),
      0.75,
    );
  const good = candidates.filter((c) => c.sharpness >= blurLine && c.motion <= SHAKY_MEAN && c.maxMotion <= SHAKY_PEAK);
  return good.length ? good : candidates;
}

export function noTalkingTarget(totalDuration: number, shotLength: number): number {
  const target = Math.min(30, Math.max(6, totalDuration * 0.35));
  return Math.max(shotLength, Math.round(target / shotLength) * shotLength);
}

/**
 * Chooses non-overlapping shots until the target length, best first (and
 * `preferred` ones, e.g. the AI's picks, before the rest). Every clip gets at
 * least one shot. The result plays in the order it was filmed.
 */
export function pickShots(candidates: Candidate[], opts: { targetSeconds: number; preferred?: number[] }): Segment[] {
  const preferred = new Map((opts.preferred ?? []).map((id, rank) => [id, rank]));
  const ranked = [...candidates].sort((a, b) => {
    const pa = preferred.get(a.id) ?? Infinity;
    const pb = preferred.get(b.id) ?? Infinity;
    return pa !== pb ? pa - pb : b.score - a.score;
  });

  const chosen: Candidate[] = [];
  const overlaps = (c: Candidate) =>
    chosen.some((x) => x.clip === c.clip && c.start < x.end + 0.25 && x.start < c.end + 0.25);
  const total = () => chosen.reduce((s, c) => s + (c.end - c.start), 0);

  // One shot from every clip first, so Multiple Clips never drops a clip.
  for (const clip of new Set(candidates.map((c) => c.clip))) {
    const best = ranked.find((c) => c.clip === clip);
    if (best) chosen.push(best);
  }
  for (const c of ranked) {
    if (total() >= opts.targetSeconds - 1e-6) break;
    if (!chosen.includes(c) && !overlaps(c)) chosen.push(c);
  }
  return chosen
    .sort((a, b) => a.clip - b.clip || a.start - b.start)
    .map(({ clip, start, end }) => ({ clip, start, end }));
}

// ---------------------------------------------------------------------------
// Unboxing / ASMR: keep the moments with satisfying sounds
// ---------------------------------------------------------------------------

/**
 * Ranges of one clip worth keeping: where crisp sounds (onsets) and sound
 * level are high. Quiet fumbling and dead handling fall below the line.
 */
export function activeRanges(
  activity: AudioActivity,
  duration: number,
  pacing: Pacing,
): { start: number; end: number }[] {
  const { pad } = PACING_PARAMS[pacing];
  const score = smooth(
    activity.onsets.map((o, i) => o * 4 + activity.rms[i]),
    5,
  );
  if (score.length === 0) return [{ start: 0, end: duration }];
  const line = Math.max(percentile(score, 0.5), mean(score) * 0.8);

  const toRanges = (keep: (i: number) => boolean) => {
    const ranges: { start: number; end: number }[] = [];
    score.forEach((_, i) => {
      if (!keep(i)) return;
      const start = Math.max(0, i * activity.window - pad);
      const end = Math.min(duration, (i + 1) * activity.window + pad);
      const last = ranges[ranges.length - 1];
      if (last && start - last.end < 0.5) last.end = end;
      else ranges.push({ start, end });
    });
    return mergeRanges(ranges.filter((r) => r.end - r.start >= 0.8));
  };

  let ranges = toRanges((i) => score[i] >= line && score[i] > 0.002);
  const kept = ranges.reduce((s, r) => s + r.end - r.start, 0);
  // Mostly quiet footage: fall back to the liveliest 40%.
  if (kept < duration * 0.2) {
    const top = percentile(score, 0.6);
    ranges = toRanges((i) => score[i] >= top);
  }
  return ranges.length ? ranges : [{ start: 0, end: duration }];
}

// ---------------------------------------------------------------------------
// Voiceover: footage under each line of the voice track
// ---------------------------------------------------------------------------

export type Span = { start: number; end: number; text: string };

/**
 * Turns sentences into back-to-back spans covering the whole voice track;
 * lines shorter than `minSeconds` are merged into the next one so shots
 * don't flicker.
 */
export function voiceSpans(sentences: Span[], voiceDuration: number, minSeconds = 1.2): Span[] {
  const spans: Span[] = [];
  for (const s of sentences) {
    const last = spans[spans.length - 1];
    if (last && last.end - last.start < minSeconds) {
      last.end = s.end;
      last.text = `${last.text} ${s.text}`;
    } else spans.push({ ...s });
  }
  if (spans.length === 0) return [{ start: 0, end: voiceDuration, text: '' }];
  // Make them contiguous from 0 to the end of the voice.
  spans[0].start = 0;
  for (let i = 0; i < spans.length - 1; i++) spans[i].end = spans[i + 1].start;
  spans[spans.length - 1].end = voiceDuration;
  const lastSpan = spans[spans.length - 1];
  if (spans.length > 1 && lastSpan.end - lastSpan.start < minSeconds / 2) {
    spans[spans.length - 2].end = lastSpan.end;
    spans.pop();
  }
  return spans;
}

/**
 * Footage for each span from its assigned clip. Clips used more than once
 * continue where they left off; a clip too short for its line hands over to
 * the next clip for the rest.
 */
export function planVoiceoverShots(spans: Span[], clipDurations: number[], assignment: number[]): Segment[] {
  const cursor = clipDurations.map(() => 0);
  const segments: Segment[] = [];
  spans.forEach((span, i) => {
    let need = span.end - span.start;
    let clip = assignment[i] ?? i % clipDurations.length;
    let guard = 0;
    while (need > 0.01 && guard++ < clipDurations.length * 3) {
      const dur = clipDurations[clip];
      if (cursor[clip] >= dur - 0.2) cursor[clip] = 0;
      const take = Math.min(need, dur - cursor[clip]);
      if (take > 0.05) {
        segments.push({ clip, start: round(cursor[clip]), end: round(cursor[clip] + take) });
        cursor[clip] += take;
        need -= take;
      }
      clip = (clip + 1) % clipDurations.length;
    }
  });
  return segments;
}

// ---------------------------------------------------------------------------
// Before & After
// ---------------------------------------------------------------------------

export type Moment = { clip: number; time: number };

/**
 * A short "before" shot ending just after its moment and an "after" shot
 * starting just before its moment, never overlapping within one clip.
 */
export function beforeAfterSegments(
  before: Moment,
  after: Moment,
  clipDurations: number[],
  lengths = { before: 2.5, after: 3.5 },
): { before: Segment; after: Segment } {
  const clampWindow = (clip: number, start: number, len: number) => {
    const dur = clipDurations[clip];
    const l = Math.min(len, dur);
    const s = Math.min(Math.max(0, start), dur - l);
    return { clip, start: round(s), end: round(s + l) };
  };
  let b = clampWindow(before.clip, before.time - lengths.before + 0.5, lengths.before);
  let a = clampWindow(after.clip, after.time - 0.5, lengths.after);

  if (before.clip === after.clip && b.end > a.start) {
    // Same clip: split the room between them at the midpoint of the two moments.
    const mid = Math.min(Math.max((before.time + after.time) / 2, 0.5), clipDurations[before.clip] - 0.5);
    b = { clip: before.clip, start: round(Math.max(0, mid - lengths.before)), end: round(mid) };
    a = { clip: after.clip, start: round(mid), end: round(Math.min(clipDurations[after.clip], mid + lengths.after)) };
  }
  return { before: b, after: a };
}
