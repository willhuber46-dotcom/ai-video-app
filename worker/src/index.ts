import { mkdir } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';

import { loadWorkerConfig } from './config';
import { claimNextRender, claimNextVideo, processRender, processVideo, type JobDeps } from './job';
import { ClaudeRetakeDetector, HeuristicRetakeDetector, ResilientRetakeDetector } from './retakes';
import { ClaudeSuggestionGenerator, HeuristicSuggestionGenerator, ResilientSuggestionGenerator } from './suggestions';
import { DeepgramTranscriber } from './transcribe';

const config = loadWorkerConfig();
await mkdir(config.tmpDir, { recursive: true });

const deps: JobDeps = {
  db: createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  transcriber: new DeepgramTranscriber(config.deepgramApiKey),
  retakes: config.anthropicEnabled
    ? new ResilientRetakeDetector(new ClaudeRetakeDetector())
    : new HeuristicRetakeDetector(),
  suggestions: config.anthropicEnabled
    ? new ResilientSuggestionGenerator(new ClaudeSuggestionGenerator())
    : new HeuristicSuggestionGenerator(),
  tmpDir: config.tmpDir,
};

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, finishing current jobs...`);
    stopping = true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(slot: number) {
  while (!stopping) {
    try {
      // Final renders first: the user is waiting on them to save.
      const render = await claimNextRender(deps.db);
      if (render) {
        console.log(`[slot ${slot}] Rendering ${render.id} for video ${render.video_id}`);
        await processRender(render, deps);
        continue;
      }
      const video = await claimNextVideo(deps.db);
      if (!video) {
        await sleep(config.pollIntervalMs);
        continue;
      }
      console.log(`[slot ${slot}] Editing ${video.id} (${video.mode}, ${video.pacing})`);
      await processVideo(video, deps);
    } catch (err) {
      console.error(`[slot ${slot}] Queue error`, err);
      await sleep(config.pollIntervalMs);
    }
  }
}

console.log(
  `Worker started: concurrency ${config.concurrency}, retakes via ${config.anthropicEnabled ? 'Claude' : 'heuristic'}`,
);
await Promise.all(Array.from({ length: config.concurrency }, (_, i) => loop(i)));
console.log('Worker stopped');
