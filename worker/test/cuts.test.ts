import { describe, expect, it } from 'vitest';

import {
  computeSilenceEdit,
  computeTalkingEdit,
  detectRestarts,
  detectRetakesHeuristic,
  mergeRanges,
  remapWords,
  splitSentences,
  type Word,
} from '../src/cuts';

/** Builds word timings from "text@start" tokens; each word lasts 0.3s. */
function words(spec: string): Word[] {
  return spec.split(/\s+/).map((token) => {
    const [text, at] = token.split('@');
    const start = Number(at);
    return { word: text.replace(/[.?!,]/g, '').toLowerCase(), punctuated: text, start, end: start + 0.3 };
  });
}

describe('splitSentences', () => {
  it('splits on end punctuation and on long pauses', () => {
    const w = words('Hi@0 there.@0.4 This@1 is@1.4 great@1.8 and@4 more@4.4');
    const s = splitSentences(w);
    expect(s.map((x) => x.text)).toEqual(['Hi there.', 'This is great', 'and more']);
    expect(s[1].start).toBe(1);
  });
});

describe('computeTalkingEdit', () => {
  it('cuts long pauses but keeps short ones, with padding', () => {
    // 0.1s gap between the first two words, 3s pause before the third.
    const w = words('one@1 two@1.4 three@4.7');
    const { decisions } = computeTalkingEdit({
      words: w,
      duration: 10,
      pacing: 'natural',
      retakeSentences: new Set(),
      retakeSource: 'none',
    });
    expect(decisions.keep).toEqual([
      { start: 0.85, end: 1.85 },
      { start: 4.55, end: 5.15 },
    ]);
    expect(decisions.removed.seconds).toBeCloseTo(10 - 1.6, 3);
  });

  it('tight pacing keeps less air than loose', () => {
    const w = words('one@1 two@1.8 three@2.6');
    const run = (pacing: 'tight' | 'loose') =>
      computeTalkingEdit({ words: w, duration: 5, pacing, retakeSentences: new Set(), retakeSource: 'none' }).decisions;
    const kept = (d: ReturnType<typeof run>) => d.keep.reduce((s, r) => s + r.end - r.start, 0);
    expect(run('tight').keep.length).toBe(3);
    expect(run('loose').keep.length).toBe(1);
    expect(kept(run('tight'))).toBeLessThan(kept(run('loose')));
  });

  it('removes filler words without padding back into them', () => {
    const w = words('so@1 um@1.35 this@1.7');
    const { decisions, keptWordIndices } = computeTalkingEdit({
      words: w,
      duration: 3,
      pacing: 'loose',
      retakeSentences: new Set(),
      retakeSource: 'none',
    });
    expect(keptWordIndices).toEqual([0, 2]);
    expect(decisions.removed.fillerWords).toBe(1);
    // Cut boundaries sit exactly at the filler's edges.
    expect(decisions.keep).toEqual([
      { start: 0.75, end: 1.35 },
      { start: 1.65, end: 2.25 },
    ]);
  });

  it('removes retake sentences', () => {
    const w = words('This@0 sweater@0.3 is@0.6 so@0.9 soft.@1.2 This@2 sweater@2.3 is@2.6 so@2.9 soft.@3.2');
    const { decisions, keptWordIndices } = computeTalkingEdit({
      words: w,
      duration: 4,
      pacing: 'tight',
      retakeSentences: new Set([0]),
      retakeSource: 'ai',
    });
    expect(keptWordIndices).toEqual([5, 6, 7, 8, 9]);
    expect(decisions.keep).toEqual([{ start: 1.92, end: 3.58 }]);
    expect(decisions.retakeSource).toBe('ai');
  });
});

describe('detectRetakesHeuristic', () => {
  const run = (spec: string) => {
    const w = words(spec);
    return [...detectRetakesHeuristic(splitSentences(w), w)];
  };

  it('drops an earlier take of a repeated line', () => {
    expect(run('This@0 sweater@1 is@2 so@3 soft.@4 This@6 sweater@7 is@8 so@9 soft.@10')).toEqual([0]);
  });

  it('drops a false start that is restarted', () => {
    expect(run('So@0 today@1 I@2 got.@3 So@5 today@6 I@7 got@8 this@9 bag.@10')).toEqual([0]);
  });

  it('keeps similar but different lines', () => {
    expect(run('This@0 one@1 is@2 blue.@3 This@5 one@6 is@7 red.@8')).toEqual([]);
  });
});

describe('detectRestarts', () => {
  it('drops the first attempt of a phrase restarted mid-sentence', () => {
    const w = words('this@0 is@1 the@2 this@3 is@4 the@5 best@6 sweater@7');
    expect([...detectRestarts(w)]).toEqual([0, 1, 2]);
  });

  it('ignores normal repetition', () => {
    const w = words('very@0 very@1 soft@2 and@3 very@4 warm@5');
    expect([...detectRestarts(w)]).toEqual([]);
  });
});

describe('computeSilenceEdit', () => {
  it('keeps the non-silent parts', () => {
    const d = computeSilenceEdit(
      [
        { start: 0, end: 2 },
        { start: 5, end: 8 },
        { start: 9, end: Number.POSITIVE_INFINITY },
      ],
      10,
      'tight',
    );
    expect(d.keep).toEqual([
      { start: 1.92, end: 5.08 },
      { start: 7.92, end: 9.08 },
    ]);
    expect(d.cutSource).toBe('silence');
  });
});

describe('mergeRanges', () => {
  it('merges overlapping and nearly touching ranges', () => {
    expect(
      mergeRanges([
        { start: 3, end: 4 },
        { start: 0, end: 1 },
        { start: 0.9, end: 2 },
        { start: 2.02, end: 2.5 },
      ]),
    ).toEqual([
      { start: 0, end: 2.5 },
      { start: 3, end: 4 },
    ]);
  });
});

describe('remapWords', () => {
  it('moves words onto the edited timeline', () => {
    const w = words('a@1 b@5');
    const out = remapWords(w, [0, 1], [
      { start: 0.9, end: 1.4 },
      { start: 4.9, end: 5.4 },
    ]);
    expect(out).toEqual([
      { word: 'a', start: 0.1, end: 0.4 },
      { word: 'b', start: 0.6, end: 0.9 },
    ]);
  });
});
