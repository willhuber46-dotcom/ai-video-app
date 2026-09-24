import { readFile } from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { normalizeZooms, ZOOM_STRENGTHS, type AiSuggestions, type WordTiming, type Zoom } from '@app/shared';
import { z } from 'zod';

import { claudeCost, type CostEntry } from './costs';
import { splitSentences } from './cuts';

export type SuggestionInput = {
  /** Kept words on the edited video's timeline. */
  transcript: WordTiming[];
  duration: number;
  /** Stills from the edited video, with their timestamps. */
  frames: { path: string; time: number }[];
};

export type SuggestionResult = { suggestions: AiSuggestions; cost?: CostEntry };

export interface SuggestionGenerator {
  suggest(input: SuggestionInput): Promise<SuggestionResult>;
}

const MODEL = 'claude-opus-5';
const DEFAULT_SCALE = ZOOM_STRENGTHS[1].value;
const MAX_ZOOMS = 8;

const SuggestionSchema = z.object({
  product: z.string(),
  texts: z.array(z.object({ text: z.string(), emoji: z.string() })),
  zooms: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      focus_x: z.number(),
      focus_y: z.number(),
    }),
  ),
});

const SYSTEM = `You help TikTok Shop affiliates finish short product videos. You receive stills from an edited vertical video (with their timestamps) and the transcript of what the creator says, with timestamps in seconds.

1. Identify the product being shown or sold.

2. Suggest 3 short on-screen text hooks for the top of the video, best first. Each is 2-6 words, lowercase or sentence case, in the voice of a creator (e.g. "the best fall sweats", "my new everyday bag", "you need this for your kitchen"), plus one fitting emoji. Use the same language as the transcript. No hashtags, prices or claims that aren't supported by the video.

3. Pick moments for a punch-in zoom: when the product is being shown up close, held up to the camera, or named / described in the transcript. Each zoom lasts 1-3 seconds, zooms don't overlap, and there are at most ${MAX_ZOOMS} (fewer for short videos; roughly one every 5-10 seconds). focus_x and focus_y are where the product is in the frame at that moment, as fractions of width and height from the top-left (0.5, 0.5 is the center). If you can't tell, use the creator's hands or 0.5, 0.45.`;

export class ClaudeSuggestionGenerator implements SuggestionGenerator {
  private client = new Anthropic();

  async suggest(input: SuggestionInput): Promise<SuggestionResult> {
    const transcript = splitSentences(input.transcript)
      .map((s) => `(${s.start.toFixed(1)}-${s.end.toFixed(1)}) ${s.text}`)
      .join('\n');

    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const frame of input.frames) {
      content.push({ type: 'text', text: `Still at ${frame.time.toFixed(1)}s:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: (await readFile(frame.path)).toString('base64') },
      });
    }
    content.push({
      type: 'text',
      text: `Video length: ${input.duration.toFixed(1)}s\n\nTranscript:\n${transcript || '(no speech)'}`,
    });

    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(SuggestionSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });

    const cost = claudeCost(response.model, response.usage.input_tokens, response.usage.output_tokens);
    const parsed = response.parsed_output;
    if (response.stop_reason === 'refusal' || !parsed) {
      return { suggestions: heuristicSuggestions(input), cost };
    }

    const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi);
    const zooms = parsed.zooms
      .map((z) => {
        const start = clamp(z.start, 0, input.duration);
        const end = clamp(Math.min(z.end, start + 3), start, input.duration);
        return { id: '', start, end, scale: DEFAULT_SCALE, x: clamp(z.focus_x, 0.1, 0.9), y: clamp(z.focus_y, 0.1, 0.9) };
      })
      .slice(0, MAX_ZOOMS);

    return {
      cost,
      suggestions: {
        source: 'ai',
        texts: parsed.texts
          .map((t) => ({ text: t.text.trim().slice(0, 60), emoji: t.emoji.trim().slice(0, 8) }))
          .filter((t) => t.text)
          .slice(0, 5),
        zooms: stripIds(normalizeZooms(zooms, input.duration)),
      },
    };
  }
}

function stripIds(zooms: Zoom[]): Omit<Zoom, 'id'>[] {
  return zooms.map(({ id: _id, ...z }) => z);
}

/**
 * Without the AI: zoom on the first line and then on a sentence start roughly
 * every 7 seconds, toward the upper-middle where products are usually held.
 * No text suggestions, since good hooks need to know the product.
 */
export function heuristicSuggestions(input: SuggestionInput): AiSuggestions {
  const zooms: Zoom[] = [];
  let lastStart = Number.NEGATIVE_INFINITY;
  for (const s of splitSentences(input.transcript)) {
    if (s.start - lastStart < 7) continue;
    zooms.push({ id: '', start: s.start, end: Math.min(s.start + 1.8, s.end + 0.3), scale: DEFAULT_SCALE, x: 0.5, y: 0.45 });
    lastStart = s.start;
  }
  return { source: 'heuristic', texts: [], zooms: stripIds(normalizeZooms(zooms, input.duration)).slice(0, MAX_ZOOMS) };
}

export class HeuristicSuggestionGenerator implements SuggestionGenerator {
  async suggest(input: SuggestionInput): Promise<SuggestionResult> {
    return { suggestions: heuristicSuggestions(input) };
  }
}

/** Tries Claude first; suggestions are optional, so any failure falls back quietly. */
export class ResilientSuggestionGenerator implements SuggestionGenerator {
  constructor(
    private primary: SuggestionGenerator,
    private fallback: SuggestionGenerator = new HeuristicSuggestionGenerator(),
  ) {}

  async suggest(input: SuggestionInput): Promise<SuggestionResult> {
    try {
      return await this.primary.suggest(input);
    } catch (err) {
      console.warn('Suggestions via Claude failed; using heuristic', err instanceof Error ? err.message : err);
      return this.fallback.suggest(input);
    }
  }
}
