function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export const pricing = {
  /** Deepgram Nova-3 pre-recorded, USD per audio minute. Check your Deepgram plan. */
  deepgramPerMinute: number('DEEPGRAM_USD_PER_MINUTE', 0.0043),
  /** What one worker costs to run, USD per hour of wall-clock processing. */
  workerPerHour: number('WORKER_USD_PER_HOUR', 0.05),
  /** Claude USD per million tokens, keyed by the model that served the request. */
  claude: {
    'claude-opus-5': { input: 5, output: 25 },
    'claude-opus-4-8': { input: 5, output: 25 },
  } as Record<string, { input: number; output: number }>,
};

export function loadWorkerConfig() {
  return {
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    deepgramApiKey: required('DEEPGRAM_API_KEY'),
    /** Optional: without it, retakes are found with the built-in heuristic. */
    anthropicEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    pollIntervalMs: number('WORKER_POLL_MS', 3000),
    concurrency: number('WORKER_CONCURRENCY', 1),
    tmpDir: process.env.WORKER_TMP_DIR ?? './tmp',
  };
}

export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
