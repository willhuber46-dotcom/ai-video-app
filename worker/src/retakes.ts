import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { claudeCost, type CostEntry } from './costs';
import { detectRetakesHeuristic, type Sentence, type Word } from './cuts';

export type RetakeResult = {
  drop: Set<number>;
  source: 'ai' | 'heuristic' | 'none';
  cost?: CostEntry;
};

export interface RetakeDetector {
  detect(sentences: Sentence[], words: Word[]): Promise<RetakeResult>;
}

const MODEL = 'claude-opus-5';

const RetakeSchema = z.object({
  remove: z.array(
    z.object({
      index: z.number().int(),
      reason: z.enum(['retake', 'false_start', 'flub']),
    }),
  ),
});

const SYSTEM = `You edit talking-to-camera videos for TikTok Shop creators. You receive the transcript of one raw recording, split into numbered sentences with timestamps in seconds.

Creators often repeat a line until they get it right, start a sentence and abandon it, or stumble and restart. Your job is to pick which sentences to cut so the finished video contains exactly one clean take of everything they meant to say.

Mark a sentence for removal when it is:
- retake: an earlier attempt at a line that is said again later. Keep the last complete take unless an earlier one is clearly better, and cut the others.
- false_start: a sentence that trails off or is abandoned and then restarted.
- flub: a stumble or self-correction where the corrected version follows ("wait, let me say that again", "no, sorry").

Never remove a sentence just because it is short, casual, or repeats a word for emphasis. Content that is only said once always stays. When unsure, keep the sentence.`;

export class ClaudeRetakeDetector implements RetakeDetector {
  private client = new Anthropic();

  async detect(sentences: Sentence[], words: Word[]): Promise<RetakeResult> {
    if (sentences.length < 2) return { drop: new Set(), source: 'none' };

    const transcript = sentences
      .map((s) => `[${s.index}] (${s.start.toFixed(1)}-${s.end.toFixed(1)}) ${s.text}`)
      .join('\n');

    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(RetakeSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Transcript:\n${transcript}` }],
    });

    const cost = claudeCost(response.model, response.usage.input_tokens, response.usage.output_tokens);
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return { ...heuristic(sentences, words), cost };
    }
    const valid = response.parsed_output.remove
      .map((r) => r.index)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < sentences.length);
    // Guard against a runaway answer that would cut most of the video.
    if (valid.length > sentences.length * 0.7) return { ...heuristic(sentences, words), cost };
    return { drop: new Set(valid), source: 'ai', cost };
  }
}

export class HeuristicRetakeDetector implements RetakeDetector {
  async detect(sentences: Sentence[], words: Word[]): Promise<RetakeResult> {
    return heuristic(sentences, words);
  }
}

function heuristic(sentences: Sentence[], words: Word[]): RetakeResult {
  return { drop: detectRetakesHeuristic(sentences, words), source: 'heuristic' };
}

/** Tries Claude first and falls back to the heuristic if the call fails. */
export class ResilientRetakeDetector implements RetakeDetector {
  constructor(
    private primary: RetakeDetector,
    private fallback: RetakeDetector = new HeuristicRetakeDetector(),
  ) {}

  async detect(sentences: Sentence[], words: Word[]): Promise<RetakeResult> {
    try {
      return await this.primary.detect(sentences, words);
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        console.warn(`Retake detection via Claude failed (${err.status}); using heuristic`, err.message);
      } else {
        console.warn('Retake detection via Claude failed; using heuristic', err);
      }
      return this.fallback.detect(sentences, words);
    }
  }
}
