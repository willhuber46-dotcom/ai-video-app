import { expiryPushMessage, expiryWarning } from '@app/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { deleteVideosWithFiles } from '../src/maintenance';

/** Just enough of the Supabase client to record what gets deleted. */
function fakeDb(renderPaths: (string | null)[]) {
  const removed: Record<string, string[]> = {};
  const deletedRows: string[] = [];
  const db = {
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: renderPaths.map((output_path) => ({ output_path })), error: null }),
      }),
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          if (table === 'videos') deletedRows.push(...ids);
          return { error: null };
        },
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed[bucket] = [...(removed[bucket] ?? []), ...paths];
          return { error: null };
        },
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, removed, deletedRows };
}

describe('deleteVideosWithFiles', () => {
  it('removes cuts, thumbnails, final renders and raw uploads before the rows', async () => {
    const { db, removed, deletedRows } = fakeDb(['u/a-final-1.mp4', null]);
    await deleteVideosWithFiles(db, [
      { id: 'a', output_path: 'u/a.mp4', thumbnail_path: 'u/a.jpg', raw_path: null },
      { id: 'b', output_path: null, thumbnail_path: null, raw_path: 'u/b.mov' },
    ]);
    expect(removed['cuts']).toEqual(['u/a.mp4', 'u/a.jpg', 'u/a-final-1.mp4']);
    expect(removed['raw-uploads']).toEqual(['u/b.mov']);
    expect(deletedRows).toEqual(['a', 'b']);
  });
});

describe('expiry wording', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();

  it('warns only in the last 3 days', () => {
    expect(expiryWarning(inHours(24 * 10), now)).toBeNull();
    expect(expiryWarning(inHours(24 * 3 + 1), now)).toBeNull();
    expect(expiryWarning(inHours(24 * 2 + 1), now)).toBe('Deletes in 2 days');
    expect(expiryWarning(inHours(30), now)).toBe('Deletes tomorrow');
    expect(expiryWarning(inHours(5), now)).toBe('Deletes today');
    expect(expiryWarning(null, now)).toBeNull();
  });

  it('pushes a clear warning', () => {
    expect(expiryPushMessage(1).title).toBe('A cut will be deleted in 3 days');
    expect(expiryPushMessage(4)).toEqual({
      title: '4 cuts will be deleted in 3 days',
      body: 'Cuts are kept for 30 days. Save them to your camera roll to keep them.',
    });
  });
});
