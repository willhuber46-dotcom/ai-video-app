import type { EditDecisions, KeepRange, Pacing, WordTiming } from '@app/shared';

/**
 * Pure Talking Mode cutting logic: given word timings, decide which ranges of
 * the source video to keep. No I/O here so it is easy to test.
 */

export type Word = WordTiming & {
  /** Word with punctuation/casing, when the transcriber provides it. */
  punctuated?: string;
};

export type Sentence = {
  index: number;
  /** Indices into the full word list. */
  wordIndices: number[];
  start: number;
  end: number;
  text: string;
};

export type PacingParams = {
  /** Seconds of breathing room kept before and after each run of speech. */
  pad: number;
  /** Pauses between words longer than this are cut. */
  maxGap: number;
};

export const PACING_PARAMS: Record<Pacing, PacingParams> = {
  tight: { pad: 0.08, maxGap: 0.35 },
  natural: { pad: 0.15, maxGap: 0.6 },
  loose: { pad: 0.25, maxGap: 1.0 },
};

const FILLERS = new Set(['um', 'uh', 'uhm', 'umm', 'uhh', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);

/** A pause this long ends a sentence even without punctuation. */
const SENTENCE_GAP_SECONDS = 1.2;

/** Ranges closer than this are merged instead of making a tiny cut. */
const MIN_CUT_SECONDS = 0.05;

export function normalizeToken(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

export function isFiller(word: Word): boolean {
  return FILLERS.has(normalizeToken(word.word));
}

export function splitSentences(words: Word[]): Sentence[] {
  const sentences: Sentence[] = [];
  let current: number[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = words[current[0]];
    const last = words[current[current.length - 1]];
    sentences.push({
      index: sentences.length,
      wordIndices: current,
      start: first.start,
      end: last.end,
      text: current.map((i) => words[i].punctuated ?? words[i].word).join(' '),
    });
    current = [];
  };

  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (prev && current.length > 0 && word.start - prev.end > SENTENCE_GAP_SECONDS) flush();
    current.push(i);
    if (/[.?!]["')\]]*$/.test(word.punctuated ?? '')) flush();
  });
  flush();
  return sentences;
}

function sentenceTokens(sentence: Sentence, words: Word[]): string[] {
  return sentence.wordIndices
    .map((i) => words[i])
    .filter((w) => !isFiller(w))
    .map((w) => normalizeToken(w.word))
    .filter(Boolean);
}

function startsWith(tokens: string[], prefix: string[]): boolean {
  return prefix.length <= tokens.length && prefix.every((t, i) => tokens[i] === t);
}

/**
 * Fallback retake detection, used when the AI call is unavailable. Flags a
 * sentence when the next one or two sentences restate it; the later take is
 * kept since creators usually re-say a line until they get it right.
 */
export function detectRetakesHeuristic(sentences: Sentence[], words: Word[]): Set<number> {
  const drop = new Set<number>();
  const tokens = sentences.map((s) => sentenceTokens(s, words));

  for (let i = 0; i < sentences.length; i++) {
    const a = tokens[i];
    if (a.length < 2) continue;
    for (let j = i + 1; j <= Math.min(i + 2, sentences.length - 1); j++) {
      const b = tokens[j];
      if (b.length < 2) continue;
      const setB = new Set(b);
      const overlap = a.filter((t) => setB.has(t)).length / Math.min(a.length, b.length);
      // False start: the sentence was abandoned, then restarted and carried further.
      const falseStart =
        startsWith(b, a) || (a.length <= 5 && b.length >= a.length + 2 && startsWith(b, a.slice(0, 2)) && overlap >= 0.75);
      const sameOpening = a.length >= 3 && b.length >= 3 && startsWith(b, a.slice(0, 3));
      if (falseStart || (sameOpening && overlap >= 0.8)) {
        drop.add(i);
        break;
      }
    }
  }
  return drop;
}

/**
 * Finds restarts inside a sentence, e.g. "this is the best this is the best
 * sweater": when a run of 3+ words repeats within a short window, the first
 * attempt is dropped. Returns word indices to remove.
 */
export function detectRestarts(words: Word[]): Set<number> {
  const drop = new Set<number>();
  const content = words.map((w, i) => ({ i, t: normalizeToken(w.word), filler: isFiller(w) })).filter((w) => !w.filler && w.t);
  const MIN_RUN = 3;
  const WINDOW = 12;

  for (let a = 0; a < content.length; a++) {
    for (let b = a + MIN_RUN; b <= Math.min(a + WINDOW, content.length - MIN_RUN); b++) {
      let run = 0;
      while (b + run < content.length && a + run < b && content[a + run].t === content[b + run].t) run++;
      if (run >= MIN_RUN) {
        // Drop everything from the first attempt up to the restart.
        for (let i = content[a].i; i < content[b].i; i++) drop.add(i);
        a = b - 1;
        break;
      }
    }
  }
  return drop;
}

export type ComputeEditInput = {
  words: Word[];
  duration: number;
  pacing: Pacing;
  /** Sentence indices (from splitSentences) to remove as retakes. */
  retakeSentences: Set<number>;
  retakeSource: EditDecisions['retakeSource'];
};

export type ComputedEdit = {
  decisions: EditDecisions;
  /** Word indices that survive the edit. */
  keptWordIndices: number[];
};

export function computeTalkingEdit(input: ComputeEditInput): ComputedEdit {
  const { words, duration, pacing } = input;
  const { pad, maxGap } = PACING_PARAMS[pacing];
  const sentences = splitSentences(words);

  const drop = new Set<number>();
  let fillerWords = 0;
  words.forEach((w, i) => {
    if (isFiller(w)) {
      drop.add(i);
      fillerWords++;
    }
  });
  for (const s of sentences) {
    if (input.retakeSentences.has(s.index)) s.wordIndices.forEach((i) => drop.add(i));
  }
  const restarts = detectRestarts(words);
  let restartCount = 0;
  for (const i of restarts) {
    if (!drop.has(i)) {
      drop.add(i);
      restartCount++;
    }
  }

  // Group kept words into runs of continuous speech.
  const groups: { first: number; last: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    if (drop.has(i)) continue;
    const current = groups[groups.length - 1];
    const contiguous = current && current.last === i - 1 && words[i].start - words[i - 1].end <= maxGap;
    if (contiguous) current.last = i;
    else groups.push({ first: i, last: i });
  }

  // Pad each run, but never pad back into a removed word.
  const ranges: KeepRange[] = groups.map(({ first, last }) => {
    const prev = words[first - 1];
    const next = words[last + 1];
    const lower = prev && drop.has(first - 1) ? prev.end : 0;
    const upper = next && drop.has(last + 1) ? next.start : duration;
    return {
      start: Math.max(0, lower, words[first].start - pad),
      end: Math.min(duration, upper, words[last].end + pad),
    };
  });

  const keep = mergeRanges(ranges);
  const keptSeconds = keep.reduce((sum, r) => sum + (r.end - r.start), 0);

  return {
    keptWordIndices: words.map((_, i) => i).filter((i) => !drop.has(i)),
    decisions: {
      pacing,
      keep,
      removed: {
        seconds: round(Math.max(0, duration - keptSeconds)),
        fillerWords,
        retakeSentences: input.retakeSentences.size,
        restarts: restartCount,
      },
      retakeSource: input.retakeSource,
      cutSource: 'transcript',
    },
  };
}

/** Used when there is no speech to cut on: keep everything that isn't silent. */
export function computeSilenceEdit(silences: KeepRange[], duration: number, pacing: Pacing): EditDecisions {
  const { pad } = PACING_PARAMS[pacing];
  const sorted = [...silences].sort((a, b) => a.start - b.start);
  const sounds: KeepRange[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) sounds.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < duration) sounds.push({ start: cursor, end: duration });

  const keep = mergeRanges(
    sounds.map((r) => ({ start: Math.max(0, r.start - pad), end: Math.min(duration, r.end + pad) })),
  );
  const keptSeconds = keep.reduce((sum, r) => sum + (r.end - r.start), 0);
  return {
    pacing,
    keep,
    removed: { seconds: round(duration - keptSeconds), fillerWords: 0, retakeSentences: 0, restarts: 0 },
    retakeSource: 'none',
    cutSource: 'silence',
  };
}

export function mergeRanges(ranges: KeepRange[]): KeepRange[] {
  const sorted = ranges.filter((r) => r.end - r.start > 0.01).sort((a, b) => a.start - b.start);
  const merged: KeepRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end < MIN_CUT_SECONDS) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged.map((r) => ({ start: round(r.start), end: round(r.end) }));
}

/**
 * Maps kept words onto the edited video's timeline, so captions (Phase 2)
 * line up with the finished cut.
 */
export function remapWords(words: Word[], keptWordIndices: number[], keep: KeepRange[]): WordTiming[] {
  const offsets: number[] = [];
  let total = 0;
  for (const r of keep) {
    offsets.push(total);
    total += r.end - r.start;
  }
  const out: WordTiming[] = [];
  for (const i of keptWordIndices) {
    const w = words[i];
    const k = keep.findIndex((r) => w.start >= r.start - 0.001 && w.start < r.end);
    if (k === -1) continue;
    const r = keep[k];
    out.push({
      word: w.punctuated ?? w.word,
      start: round(offsets[k] + (w.start - r.start)),
      end: round(offsets[k] + (Math.min(w.end, r.end) - r.start)),
    });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
