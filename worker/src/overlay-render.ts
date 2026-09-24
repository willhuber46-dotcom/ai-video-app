import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  CAPTION_MAX_WIDTH,
  CAPTION_STYLES,
  captionFrameAt,
  captionTokens,
  contrastColor,
  fitInSafeZone,
  FONTS,
  groupCaptions,
  TEXT_LAYOUT,
  TEXT_MAX_WIDTH,
  type CaptionFrame,
  type CaptionStyle,
  type FontKey,
  type OverlayDoc,
  type TextOverlay,
} from '@app/shared';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * Draws captions and on-screen text into transparent PNGs, one per distinct
 * on-screen state, and lists them with durations in an ffconcat file that
 * FFmpeg overlays onto the video in a single pass.
 */

const EMOJI_FAMILY = 'Noto Color Emoji';
const EMOJI_FONT_PATHS = [
  process.env.EMOJI_FONT_PATH,
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto/NotoColorEmoji.ttf',
].filter(Boolean) as string[];

let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  const require = createRequire(import.meta.url);
  for (const font of Object.values(FONTS)) {
    GlobalFonts.registerFromPath(require.resolve(font.file), font.family);
  }
  const emoji = EMOJI_FONT_PATHS.find((p) => existsSync(p));
  if (emoji) GlobalFonts.registerFromPath(emoji, EMOJI_FAMILY);
  else console.warn('No color emoji font found; emoji will not render. Install fonts-noto-color-emoji.');
  fontsLoaded = true;
}

function fontString(font: FontKey, px: number) {
  return `${px}px "${FONTS[font].family}", "${EMOJI_FAMILY}"`;
}

type Token = { text: string; active: boolean };
type Line = { tokens: { token: Token; width: number }[]; width: number };

/** Greedy word wrap; a single word wider than the line gets a line of its own. */
function wrapTokens(ctx: SKRSContext2D, tokens: Token[], maxWidth: number): Line[] {
  const space = ctx.measureText(' ').width;
  const lines: Line[] = [];
  let line: Line = { tokens: [], width: 0 };
  for (const token of tokens) {
    const width = ctx.measureText(token.text).width;
    const added = line.tokens.length ? space + width : width;
    if (line.tokens.length && line.width + added > maxWidth) {
      lines.push(line);
      line = { tokens: [], width: 0 };
    }
    line.width += line.tokens.length ? space + width : width;
    line.tokens.push({ token, width });
  }
  if (line.tokens.length) lines.push(line);
  return lines;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function drawCaption(ctx: SKRSContext2D, frame: CaptionFrame, style: CaptionStyle, centerY: number, W: number, H: number) {
  const spec = CAPTION_STYLES[style];
  const px = spec.size * W;
  ctx.font = fontString(spec.font, px);
  const lines = wrapTokens(ctx, captionTokens(frame, style), CAPTION_MAX_WIDTH * W);
  const lineHeight = px * TEXT_LAYOUT.lineHeight;
  const blockH = lines.length * lineHeight;
  const blockW = Math.max(...lines.map((l) => l.width));
  const pos = fitInSafeZone(0.5, centerY, blockW / 2 / W, blockH / 2 / H);
  const space = ctx.measureText(' ').width;

  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((line, li) => {
    let x = pos.x * W - line.width / 2;
    const y = pos.y * H - blockH / 2 + lineHeight * (li + 0.5);
    for (const { token, width } of line.tokens) {
      if (token.active && spec.activeBackground) {
        ctx.fillStyle = spec.activeBackground;
        const padX = px * TEXT_LAYOUT.activePadX;
        const padY = px * TEXT_LAYOUT.activePadY;
        roundRect(ctx, x - padX, y - lineHeight / 2 + padY, width + padX * 2, lineHeight - padY * 2, px * TEXT_LAYOUT.activeRadius);
      }
      if (spec.strokeWidth > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.lineWidth = px * spec.strokeWidth;
        ctx.strokeText(token.text, x, y);
      }
      ctx.fillStyle = token.active && spec.activeColor ? spec.activeColor : spec.color;
      ctx.fillText(token.text, x, y);
      x += width + space;
    }
  });
}

function drawText(ctx: SKRSContext2D, overlay: TextOverlay, W: number, H: number) {
  const px = overlay.size * W;
  ctx.font = fontString(overlay.font, px);
  const tokens = overlay.text.split(/\s+/).filter(Boolean).map((text) => ({ text, active: false }));
  // Respect line breaks the user typed.
  const lines = overlay.text
    .split('\n')
    .flatMap((para) => wrapTokens(ctx, para.split(/\s+/).filter(Boolean).map((text) => ({ text, active: false })), TEXT_MAX_WIDTH * W));
  if (tokens.length === 0) return;

  const lineHeight = px * TEXT_LAYOUT.lineHeight;
  const padX = overlay.background ? px * TEXT_LAYOUT.boxPadX : 0;
  const padY = overlay.background ? px * TEXT_LAYOUT.boxPadY : 0;
  const blockW = Math.max(...lines.map((l) => l.width)) + padX * 2;
  const blockH = lines.length * lineHeight + padY * 2;
  const pos = fitInSafeZone(overlay.x, overlay.y, blockW / 2 / W, blockH / 2 / H);
  const left = pos.x * W - blockW / 2;
  const top = pos.y * H - blockH / 2;

  if (overlay.background) {
    ctx.fillStyle = overlay.color;
    roundRect(ctx, left, top, blockW, blockH, px * TEXT_LAYOUT.boxRadius);
  }
  const space = ctx.measureText(' ').width;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = overlay.background ? contrastColor(overlay.color) : overlay.color;
  if (!overlay.background) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = px * TEXT_LAYOUT.shadowBlur;
  }
  lines.forEach((line, li) => {
    let x = pos.x * W - line.width / 2;
    const y = top + padY + lineHeight * (li + 0.5);
    for (const { token, width } of line.tokens) {
      ctx.fillText(token.text, x, y);
      x += width + space;
    }
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
}

/**
 * Renders the overlay track. Returns the ffconcat path, or null when there is
 * nothing to draw (zoom-only edits).
 */
export async function renderOverlayTrack(opts: {
  doc: OverlayDoc;
  width: number;
  height: number;
  duration: number;
  workDir: string;
}): Promise<string | null> {
  const { doc, width: W, height: H, duration, workDir } = opts;
  const groups = doc.captions ? groupCaptions(doc.captions.words, doc.captions.style) : [];
  const texts = doc.texts.filter((t) => t.text.trim() && t.end > t.start);
  if (groups.length === 0 && texts.length === 0) return null;
  loadFonts();

  // Every moment the picture can change.
  const cuts = new Set<number>([0, duration]);
  for (const g of groups) {
    cuts.add(g.start);
    cuts.add(g.end);
    g.words.forEach((w) => cuts.add(w.start));
  }
  for (const t of texts) {
    cuts.add(t.start);
    cuts.add(t.end);
  }
  const times = [...cuts].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const files = new Map<string, string>();
  const entries: { file: string; duration: number }[] = [];

  for (let i = 0; i < times.length - 1; i++) {
    const span = times[i + 1] - times[i];
    if (span <= 0.0005) continue;
    const mid = times[i] + span / 2;
    const frame = captionFrameAt(groups, mid);
    const visible = texts.filter((t) => mid >= t.start && mid < t.end);
    const key = JSON.stringify([frame && groups.indexOf(frame.group), frame?.activeIndex, visible.map((t) => t.id)]);

    let file = files.get(key);
    if (!file) {
      ctx.clearRect(0, 0, W, H);
      for (const t of visible) drawText(ctx, t, W, H);
      if (frame && doc.captions) drawCaption(ctx, frame, doc.captions.style, doc.captions.y, W, H);
      file = path.join(workDir, `overlay-${files.size}.png`);
      await writeFile(file, await canvas.encode('png'));
      files.set(key, file);
    }
    const last = entries[entries.length - 1];
    if (last && last.file === file) last.duration += span;
    else entries.push({ file, duration: span });
  }

  const lines = ['ffconcat version 1.0'];
  for (const e of entries) lines.push(`file '${path.resolve(e.file)}'`, `duration ${e.duration.toFixed(4)}`);
  // The concat demuxer needs the last file repeated for its duration to count.
  lines.push(`file '${path.resolve(entries[entries.length - 1].file)}'`);
  const list = path.join(workDir, 'overlay.ffconcat');
  await writeFile(list, lines.join('\n'));
  return list;
}
