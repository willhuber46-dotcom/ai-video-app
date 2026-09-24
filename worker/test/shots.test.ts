import { describe, expect, it } from 'vitest';

import { audioActivity, frameMetrics, type FrameMetrics } from '../src/analysis';
import {
  activeRanges,
  beforeAfterSegments,
  noTalkingTarget,
  pickShots,
  planVoiceoverShots,
  scoreWindows,
  usableCandidates,
  voiceSpans,
} from '../src/shots';

/** Metrics at 4 fps from per-second sharpness/motion values. */
function metrics(perSecond: { sharp: number; motion: number }[]): FrameMetrics {
  const sharpness: number[] = [];
  const motion: number[] = [];
  for (const s of perSecond) {
    for (let i = 0; i < 4; i++) {
      sharpness.push(s.sharp);
      motion.push(s.motion);
    }
  }
  return { fps: 4, sharpness, motion };
}

describe('frameMetrics', () => {
  it('scores a checkerboard sharper than flat gray and measures change', () => {
    const w = 8;
    const h = 8;
    const flat = new Uint8Array(w * h).fill(128);
    const checker = Uint8Array.from({ length: w * h }, (_, i) => (((i % w) + Math.floor(i / w)) % 2 ? 255 : 0));
    const m = frameMetrics(new Uint8Array([...flat, ...checker]), w, h, 4);
    expect(m.sharpness[0]).toBe(0);
    expect(m.sharpness[1]).toBeGreaterThan(1000);
    expect(m.motion[1]).toBeCloseTo(127.5, 0);
  });
});

describe('No Talking shot picking', () => {
  // 10s clip: 0-4s sharp and steady, 4-7s blurry, 7-10s shaky.
  const clip = metrics([
    ...Array(4).fill({ sharp: 900, motion: 4 }),
    ...Array(3).fill({ sharp: 50, motion: 3 }),
    ...Array(3).fill({ sharp: 900, motion: 40 }),
  ]);
  const second = metrics(Array(6).fill({ sharp: 600, motion: 2 }));

  it('drops blurry and shaky windows', () => {
    const usable = usableCandidates(scoreWindows([{ metrics: clip, duration: 10 }], 2));
    expect(usable.length).toBeGreaterThan(0);
    for (const c of usable) {
      expect(c.end <= 4.5 || c.start >= 7).toBe(true);
      expect(c.start < 7).toBe(true);
    }
  });

  it('fills the target with non-overlapping shots from every clip, in filmed order', () => {
    const candidates = usableCandidates(
      scoreWindows(
        [
          { metrics: clip, duration: 10 },
          { metrics: second, duration: 6 },
        ],
        2,
      ),
    );
    const shots = pickShots(candidates, { targetSeconds: 6 });
    expect(shots.reduce((s, x) => s + x.end - x.start, 0)).toBeGreaterThanOrEqual(6);
    expect(new Set(shots.map((s) => s.clip))).toEqual(new Set([0, 1]));
    for (let i = 1; i < shots.length; i++) {
      const [a, b] = [shots[i - 1], shots[i]];
      expect(a.clip < b.clip || a.end <= b.start).toBe(true);
    }
  });

  it('puts preferred (AI-picked) shots first', () => {
    const candidates = scoreWindows([{ metrics: second, duration: 6 }], 2);
    const shots = pickShots(candidates, { targetSeconds: 2, preferred: [candidates[candidates.length - 1].id] });
    expect(shots).toEqual([{ clip: 0, start: 4, end: 6 }]);
  });

  it('aims for about a third of the footage, 6-30s', () => {
    expect(noTalkingTarget(10, 2)).toBe(6);
    expect(noTalkingTarget(60, 2)).toBe(22);
    expect(noTalkingTarget(600, 2)).toBe(30);
  });
});

describe('Unboxing active ranges', () => {
  it('keeps bursts of crisp sound and cuts the quiet handling', () => {
    const rate = 8000;
    const samples = new Int16Array(rate * 10);
    // Clicky noise bursts at 2-3s and 7-8s, near-silence elsewhere.
    for (const [a, b] of [
      [2, 3],
      [7, 8],
    ]) {
      for (let i = a * rate; i < b * rate; i++) samples[i] = (i % 40 < 3 ? 1 : -1) * 12000 * Math.random();
    }
    const ranges = activeRanges(audioActivity(samples, rate), 10, 'tight');
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBeLessThanOrEqual(2);
    expect(ranges[0].end).toBeGreaterThanOrEqual(3);
    expect(ranges[1].start).toBeLessThanOrEqual(7);
    const kept = ranges.reduce((s, r) => s + r.end - r.start, 0);
    expect(kept).toBeLessThan(5);
  });
});

describe('Voiceover planning', () => {
  it('merges short lines and covers the whole voice track', () => {
    const spans = voiceSpans(
      [
        { start: 0.3, end: 2.5, text: 'This bag is amazing.' },
        { start: 2.7, end: 3.2, text: 'Seriously.' },
        { start: 3.4, end: 6, text: 'It fits everything.' },
      ],
      6.5,
    );
    expect(spans.map((s) => [s.start, s.end])).toEqual([
      [0, 2.7],
      [2.7, 6.5],
    ]);
    expect(spans[1].text).toBe('Seriously. It fits everything.');
  });

  it('continues a reused clip and hands over when a clip runs out', () => {
    const spans = [
      { start: 0, end: 3, text: 'a' },
      { start: 3, end: 5, text: 'b' },
      { start: 5, end: 9, text: 'c' },
    ];
    const segments = planVoiceoverShots(spans, [4, 10], [0, 0, 1]);
    expect(segments).toEqual([
      { clip: 0, start: 0, end: 3 },
      // Clip 0 has 1s left, then clip 1 fills the rest of line "b".
      { clip: 0, start: 3, end: 4 },
      { clip: 1, start: 0, end: 1 },
      { clip: 1, start: 1, end: 5 },
    ]);
    const total = segments.reduce((s, x) => s + x.end - x.start, 0);
    expect(total).toBeCloseTo(9);
  });
});

describe('beforeAfterSegments', () => {
  it('uses windows around each moment in different clips', () => {
    expect(beforeAfterSegments({ clip: 0, time: 1 }, { clip: 1, time: 4 }, [8, 8])).toEqual({
      before: { clip: 0, start: 0, end: 2.5 },
      after: { clip: 1, start: 3.5, end: 7 },
    });
  });

  it('never overlaps within one clip', () => {
    const { before, after } = beforeAfterSegments({ clip: 0, time: 3 }, { clip: 0, time: 5 }, [10]);
    expect(before.end).toBeLessThanOrEqual(after.start);
    expect(before.end - before.start).toBeGreaterThan(1);
  });
});
