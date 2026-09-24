import { readFile } from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { claudeCost, type CostEntry } from './costs';

/**
 * The judgment calls in No Talking, Voiceover and Before & After that need
 * eyes on the footage. Every method may return null, and the modes then fall
 * back to signal-based choices, so a missing key or an API error never fails
 * an edit.
 */

export type Still = { id: number; path: string; label: string };

export type AiAnswer<T> = { value: T | null; cost?: CostEntry };

export interface ModeAi {
  /** No Talking: ids of the stills that show the product best, best first. */
  rankShots(stills: Still[], want: number): Promise<AiAnswer<number[]>>;
  /** Voiceover: for each line, the index of the clip that fits it best. */
  matchClips(clipStills: Still[][], lines: string[]): Promise<AiAnswer<number[]>>;
  /** Before & After: the still showing the "before" state and the one showing "after". */
  findBeforeAfter(stills: Still[]): Promise<AiAnswer<{ before: number; after: number }>>;
}

export class NoModeAi implements ModeAi {
  async rankShots(): Promise<AiAnswer<number[]>> {
    return { value: null };
  }
  async matchClips(): Promise<AiAnswer<number[]>> {
    return { value: null };
  }
  async findBeforeAfter(): Promise<AiAnswer<{ before: number; after: number }>> {
    return { value: null };
  }
}

const MODEL = 'claude-opus-5';

async function stillBlocks(stills: Still[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const s of stills) {
    blocks.push({ type: 'text', text: s.label });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: (await readFile(s.path)).toString('base64') },
    });
  }
  return blocks;
}

export class ClaudeModeAi implements ModeAi {
  private client = new Anthropic();

  private async ask<S extends z.ZodType>(
    schema: S,
    system: string,
    content: Anthropic.Beta.BetaContentBlockParam[],
  ): Promise<AiAnswer<z.infer<S>>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        system,
        messages: [{ role: 'user', content }],
      });
      const cost = claudeCost(response.model, response.usage.input_tokens, response.usage.output_tokens);
      if (response.stop_reason === 'refusal' || !response.parsed_output) return { value: null, cost };
      return { value: response.parsed_output as z.infer<S>, cost };
    } catch (err) {
      if (err instanceof Anthropic.APIError)
        console.warn(`Claude call failed (${err.status}); using fallback`, err.message);
      else console.warn('Claude call failed; using fallback', err);
      return { value: null };
    }
  }

  async rankShots(stills: Still[], want: number) {
    const answer = await this.ask(
      z.object({ best: z.array(z.number().int()) }),
      `You pick shots for a TikTok Shop product video with no talking (outfits, home decor, gadgets). Each still is the middle of a candidate 2-second shot. Prefer shots where the product is shown clearly: close-ups, turns and details, good light, product in frame. Avoid shots where the product is cut off, hidden, or the frame is mostly empty. Return the ids of the best ${want} shots, best first, varied rather than near-duplicates.`,
      await stillBlocks(stills),
    );
    const ids = new Set(stills.map((s) => s.id));
    return { ...answer, value: answer.value?.best.filter((id) => ids.has(id)) ?? null };
  }

  async matchClips(clipStills: Still[][], lines: string[]) {
    const content = await stillBlocks(clipStills.flat());
    content.push({
      type: 'text',
      text: `Voiceover lines, in order:\n${lines.map((l, i) => `${i}: ${l || '(pause)'}`).join('\n')}`,
    });
    const answer = await this.ask(
      z.object({ clips: z.array(z.number().int()) }),
      `A creator filmed ${clipStills.length} silent product clips and recorded a voiceover. The stills are labelled with their clip number. For each voiceover line, choose the clip whose footage best shows what the line is about. Return one clip number per line, in line order. Reusing a clip is fine; avoid showing the same clip for many lines in a row when another fits.`,
      content,
    );
    const valid = answer.value?.clips;
    const ok = valid && valid.length === lines.length && valid.every((c) => c >= 0 && c < clipStills.length);
    return { ...answer, value: ok ? valid : null };
  }

  async findBeforeAfter(stills: Still[]) {
    const answer = await this.ask(
      z.object({ before: z.number().int(), after: z.number().int() }),
      `The stills come from a creator's before-and-after video (cleaning, beauty, hair, organizing and similar), labelled with their id, clip and time. Pick the id of the still that best shows the "before" state (messy, untreated, unfinished) and the id that best shows the finished "after" result.`,
      await stillBlocks(stills),
    );
    const ids = new Set(stills.map((s) => s.id));
    const v = answer.value;
    return { ...answer, value: v && ids.has(v.before) && ids.has(v.after) && v.before !== v.after ? v : null };
  }
}
