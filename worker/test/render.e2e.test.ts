import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EMPTY_OVERLAYS, type OverlayDoc } from '@app/shared';
import { loadImage } from '@napi-rs/canvas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probe } from '../src/ffmpeg';
import { renderFinal, zoomExpressions } from '../src/render';

let dir: string;
let input: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'render-e2e-'));
  input = path.join(dir, 'cut.mp4');
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', input,
  ]);
}, 60_000);

afterAll(async () => {
  if (process.env.KEEP_RENDER_TEST) console.log('Render test files in', dir);
  else await rm(dir, { recursive: true, force: true });
});

/** Grabs one frame as PNG and returns its pixels. */
async function frameAt(video: string, t: number) {
  const png = path.join(dir, `${path.basename(video)}-${t}.png`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', video, '-frames:v', '1', png]);
  const img = await loadImage(png);
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/** Mean absolute difference (0-255) over a region given in fractions of the frame. */
type Pixels = { data: Uint8ClampedArray; width: number; height: number };

function diff(a: Pixels, b: Pixels, region = { x0: 0, y0: 0, x1: 1, y1: 1 }) {
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(region.y0 * a.height); y < region.y1 * a.height; y++) {
    for (let x = Math.floor(region.x0 * a.width); x < region.x1 * a.width; x++) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

describe('zoomExpressions', () => {
  it('builds a ramped scale and nested focus', () => {
    const z = zoomExpressions([
      { id: 'a', start: 1, end: 2, scale: 1.5, x: 0.3, y: 0.4 },
      { id: 'b', start: 4, end: 5, scale: 1.2, x: 0.6, y: 0.7 },
    ]);
    expect(z.focusX).toBe('if(between(t,1.0000,2.0000),0.3000,if(between(t,4.0000,5.0000),0.6000,0.5))');
    expect(z.scale.startsWith('1+if(between(t,1.0000,2.0000),0.5000*')).toBe(true);
  });
});

describe('renderFinal', () => {
  it('burns in captions, text and a zoom', async () => {
    const doc: OverlayDoc = {
      version: 1,
      captions: {
        style: 'highlight',
        y: 0.66,
        words: [
          { id: '1', text: 'This', start: 0.5, end: 0.8 },
          { id: '2', text: 'sweater', start: 0.8, end: 1.3 },
          { id: '3', text: 'is', start: 1.3, end: 1.5 },
          { id: '4', text: 'unreal.', start: 1.5, end: 2.2 },
        ],
      },
      texts: [
        {
          id: 't',
          text: 'the best fall sweats 🍂',
          font: 'montserrat-extrabold',
          color: '#FFFFFF',
          background: false,
          x: 0.5,
          y: 0.2,
          size: 0.07,
          start: 0,
          end: 6,
        },
      ],
      zooms: [{ id: 'z', start: 3, end: 5.5, scale: 1.5, x: 0.3, y: 0.3 }],
    };
    const output = path.join(dir, 'final.mp4');
    await renderFinal({ input, doc, output, workDir: dir });

    const out = await probe(output);
    expect(out.width).toBe(540);
    expect(out.height).toBe(960);
    expect(out.hasAudio).toBe(true);
    expect(out.duration).toBeCloseTo(6, 0);

    // Caption drawn in the lower-middle while words are spoken, gone afterwards.
    const captionRegion = { x0: 0.15, y0: 0.6, x1: 0.85, y1: 0.72 };
    expect(diff(await frameAt(output, 1.0), await frameAt(input, 1.0), captionRegion)).toBeGreaterThan(8);
    expect(diff(await frameAt(output, 2.9), await frameAt(input, 2.9), captionRegion)).toBeLessThan(3);

    // Text at the top for the whole video.
    const textRegion = { x0: 0.1, y0: 0.16, x1: 0.9, y1: 0.24 };
    expect(diff(await frameAt(output, 2.9), await frameAt(input, 2.9), textRegion)).toBeGreaterThan(8);

    // The zoom changes the whole picture mid-zoom, not before it.
    const lower = { x0: 0, y0: 0.3, x1: 1, y1: 0.55 };
    expect(diff(await frameAt(output, 2.5), await frameAt(input, 2.5), lower)).toBeLessThan(3);
    expect(diff(await frameAt(output, 4.2), await frameAt(input, 4.2), lower)).toBeGreaterThan(15);
  }, 120_000);

  it('passes an empty doc through as a plain re-encode', async () => {
    const output = path.join(dir, 'plain.mp4');
    await renderFinal({ input, doc: EMPTY_OVERLAYS, output, workDir: dir });
    expect(diff(await frameAt(output, 2), await frameAt(input, 2))).toBeLessThan(3);
  }, 60_000);
});
