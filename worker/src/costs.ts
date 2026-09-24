import { pricing } from './config';

export type CostEntry = {
  kind: 'transcription' | 'ai' | 'compute';
  provider: string;
  units: number;
  unit: string;
  usd: number;
  meta?: Record<string, unknown>;
};

export function computeCost(seconds: number): CostEntry {
  return {
    kind: 'compute',
    provider: 'worker',
    units: seconds,
    unit: 'second',
    usd: (seconds / 3600) * pricing.workerPerHour,
  };
}

export function claudeCost(model: string, inputTokens: number, outputTokens: number): CostEntry {
  const rate = pricing.claude[model] ?? pricing.claude['claude-opus-5'];
  return {
    kind: 'ai',
    provider: `anthropic:${model}`,
    units: inputTokens + outputTokens,
    unit: 'token',
    usd: (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000,
    meta: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}
