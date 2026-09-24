/**
 * Run Talking Mode on a local file without Supabase, e.g.
 *   npm run cut -w worker -- ~/raw.mp4 --pacing tight --out ~/cut.mp4
 * Needs DEEPGRAM_API_KEY; uses Claude for retakes when ANTHROPIC_API_KEY is set.
 */
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { Pacing } from '@app/shared';

import { ClaudeRetakeDetector, HeuristicRetakeDetector, ResilientRetakeDetector } from './retakes';
import { editTalkingVideo } from './talking';
import { DeepgramTranscriber } from './transcribe';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pacing: { type: 'string', default: 'natural' },
    language: { type: 'string', default: 'en' },
    out: { type: 'string' },
  },
});

const input = positionals[0];
if (!input) {
  console.error('Usage: npm run cut -w worker -- <input.mp4> [--pacing tight|natural|loose] [--language en] [--out cut.mp4]');
  process.exit(1);
}
const pacing = values.pacing as Pacing;
if (!['tight', 'natural', 'loose'].includes(pacing)) throw new Error(`Unknown pacing ${pacing}`);
const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) throw new Error('Set DEEPGRAM_API_KEY');

const out = values.out ?? input.replace(/(\.\w+)?$/, '.cut.mp4');
const workDir = await mkdtemp(path.join(os.tmpdir(), 'cut-'));
try {
  const result = await editTalkingVideo({
    inputPath: input,
    workDir,
    pacing,
    language: values.language!,
    transcriber: new DeepgramTranscriber(apiKey),
    retakes: process.env.ANTHROPIC_API_KEY
      ? new ResilientRetakeDetector(new ClaudeRetakeDetector())
      : new HeuristicRetakeDetector(),
  });
  await copyFile(result.outputPath, out);
  await writeFile(out.replace(/\.mp4$/, '.json'), JSON.stringify(result.decisions, null, 2));
  const usd = result.costs.reduce((s, c) => s + c.usd, 0);
  console.log(`${result.sourceDuration.toFixed(1)}s -> ${result.outputDuration.toFixed(1)}s`, result.decisions.removed);
  console.log(`Retakes: ${result.decisions.retakeSource}. Cost: $${usd.toFixed(4)}. Wrote ${out}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
