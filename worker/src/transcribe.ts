import { readFile } from 'node:fs/promises';

import { pricing } from './config';
import type { Word } from './cuts';
import type { CostEntry } from './costs';

export type Transcription = {
  words: Word[];
  cost: CostEntry;
};

export interface Transcriber {
  transcribe(audioFile: string, language: string): Promise<Transcription>;
}

type DeepgramResponse = {
  metadata?: { duration?: number };
  results?: {
    channels?: {
      alternatives?: {
        words?: { word: string; start: number; end: number; punctuated_word?: string }[];
      }[];
    }[];
  };
};

/** Deepgram Nova-3 over its REST API, with filler words kept so we can cut them. */
export class DeepgramTranscriber implements Transcriber {
  constructor(private apiKey: string) {}

  async transcribe(audioFile: string, language: string): Promise<Transcription> {
    const params = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      punctuate: 'true',
      filler_words: 'true',
      language,
    });
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': 'audio/flac' },
      body: await readFile(audioFile),
    });
    if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as DeepgramResponse;

    const raw = data.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    const minutes = (data.metadata?.duration ?? 0) / 60;
    return {
      words: raw.map((w) => ({ word: w.word, punctuated: w.punctuated_word, start: w.start, end: w.end })),
      cost: {
        kind: 'transcription',
        provider: 'deepgram:nova-3',
        units: minutes,
        unit: 'audio_minute',
        usd: minutes * pricing.deepgramPerMinute,
      },
    };
  }
}
