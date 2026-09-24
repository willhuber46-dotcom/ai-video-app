import { batchFinishedMessage, batchProgressLabel, summarizeBatch } from '@app/shared';
import { describe, expect, it, vi } from 'vitest';

import { ExpoPushSender } from '../src/notify';

describe('summarizeBatch / batchProgressLabel', () => {
  it('counts statuses and knows when a batch is finished', () => {
    const s = summarizeBatch(['done', 'done', 'editing', 'queued', 'uploading', 'failed']);
    expect(s).toMatchObject({ total: 6, done: 2, failed: 1, uploading: 1, editing: 2, finished: false });
    expect(batchProgressLabel(s)).toBe('2 of 6 done, 1 failed');
    expect(summarizeBatch(['done', 'failed']).finished).toBe(true);
    expect(batchProgressLabel(summarizeBatch(['done', 'done', 'done']))).toBe('All 3 done');
  });
});

describe('batchFinishedMessage', () => {
  it('reads naturally for every outcome', () => {
    expect(batchFinishedMessage(1, 1, 0).title).toBe('Your video is ready ✂️');
    expect(batchFinishedMessage(10, 10, 0).title).toBe('All 10 videos are ready ✂️');
    expect(batchFinishedMessage(10, 8, 2)).toEqual({
      title: '8 of 10 videos are ready ✂️',
      body: '2 need another try. Open the app to retry.',
    });
    expect(batchFinishedMessage(3, 0, 3).title).toBe('Your videos couldn’t be edited');
  });
});

describe('ExpoPushSender', () => {
  it('posts to Expo and reports unregistered devices', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string);
      expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[a]', title: 'Hi', sound: 'default' });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
      return new Response(
        JSON.stringify({
          data: [{ status: 'ok' }, { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }],
        }),
      );
    });
    const sender = new ExpoPushSender('secret', fetchMock as unknown as typeof fetch);
    const result = await sender.send([
      { to: 'ExponentPushToken[a]', title: 'Hi', body: 'x' },
      { to: 'ExponentPushToken[b]', title: 'Hi', body: 'x' },
    ]);
    expect(result.invalidTokens).toEqual(['ExponentPushToken[b]']);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
