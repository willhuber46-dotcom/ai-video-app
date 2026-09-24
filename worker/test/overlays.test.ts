import {
  captionFrameAt,
  captionTokens,
  fitInSafeZone,
  groupCaptions,
  normalizeZooms,
  SAFE_RECT,
  zoomAt,
  type CaptionWord,
  type Zoom,
} from '@app/shared';
import { describe, expect, it } from 'vitest';

const words = (spec: string): CaptionWord[] =>
  spec.split(' ').map((token, i) => {
    const [text, at] = token.split('@');
    return { id: String(i), text, start: Number(at), end: Number(at) + 0.25 };
  });

describe('groupCaptions', () => {
  it('breaks pop captions every 3 words, at sentence ends and at pauses', () => {
    const g = groupCaptions(words('so@0 this@0.3 is@0.6 my@0.9 fave.@1.2 grab@1.5 it@3'), 'pop');
    expect(g.map((x) => x.words.map((w) => w.text).join(' '))).toEqual(['so this is', 'my fave.', 'grab', 'it']);
  });

  it('keeps each group up briefly without overlapping the next', () => {
    const g = groupCaptions(words('one@0 two@0.3 three@0.6 four@0.8'), 'pop');
    expect(g[0].end).toBe(0.8);
    expect(g[1].end).toBeCloseTo(1.45);
  });
});

describe('captionFrameAt / captionTokens', () => {
  const g = groupCaptions(words('this@0 is@0.3 great@0.6'), 'pop');

  it('reveals words one by one for pop style', () => {
    const frame = captionFrameAt(g, 0.4)!;
    expect(captionTokens(frame, 'pop')).toEqual([
      { text: 'THIS', active: false },
      { text: 'IS', active: true },
    ]);
  });

  it('shows the whole group for highlight style', () => {
    const hg = groupCaptions(words('this@0 is@0.3 great@0.6'), 'highlight');
    expect(captionTokens(captionFrameAt(hg, 0.7)!, 'highlight').map((t) => t.active)).toEqual([false, false, true]);
  });

  it('is empty between groups', () => {
    expect(captionFrameAt(g, 5)).toBeNull();
  });
});

describe('zoomAt', () => {
  const zoom: Zoom = { id: 'z', start: 1, end: 3, scale: 1.5, x: 0.9, y: 0.5 };

  it('is identity outside zooms', () => {
    expect(zoomAt([zoom], 0.5)).toEqual({ scale: 1, left: 0, top: 0 });
  });

  it('eases in and holds full scale, clamping the crop to the frame', () => {
    expect(zoomAt([zoom], 1.125).scale).toBeCloseTo(1.25);
    const full = zoomAt([zoom], 2);
    expect(full.scale).toBe(1.5);
    // Focus at x=0.9 would push the crop past the right edge, so it stops at 1 - 1/1.5.
    expect(full.left).toBeCloseTo(1 - 1 / 1.5);
    expect(full.top).toBeCloseTo(0.5 - 0.5 / 1.5);
  });
});

describe('normalizeZooms', () => {
  it('sorts, trims overlaps, clamps to the video and drops tiny zooms', () => {
    const z = (start: number, end: number): Zoom => ({ id: `${start}`, start, end, scale: 1.3, x: 0.5, y: 0.5 });
    expect(normalizeZooms([z(4, 6), z(1, 3), z(2.5, 4.2), z(9, 12)], 10).map((x) => [x.start, x.end])).toEqual([
      [1, 3],
      [3, 4.2],
      [4.2, 6],
      [9, 10],
    ]);
    expect(normalizeZooms([z(1, 3), z(2.8, 3.2)], 10)).toHaveLength(1);
  });
});

describe('fitInSafeZone', () => {
  it('keeps boxes out of the TikTok UI', () => {
    expect(fitInSafeZone(0.95, 0.95, 0.1, 0.05)).toEqual({ x: SAFE_RECT.right - 0.1, y: SAFE_RECT.bottom - 0.05 });
    expect(fitInSafeZone(0.5, 0.5, 0.1, 0.1)).toEqual({ x: 0.5, y: 0.5 });
  });
});
