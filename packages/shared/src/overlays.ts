import type { WordTiming } from './db';

/**
 * The editable layer on top of a finished cut: captions, on-screen text and
 * zooms. The app renders it live over the player; the worker burns it into
 * the final video. Positions and sizes are fractions of the video frame so
 * both renderers produce the same layout at any resolution.
 */

// ---------------------------------------------------------------------------
// Fonts (bundled TTFs from @expo-google-fonts, loaded by both app and worker)
// ---------------------------------------------------------------------------

export type FontKey =
  | 'montserrat-black'
  | 'montserrat-extrabold'
  | 'inter-semibold'
  | 'poppins-bold'
  | 'playfair-bold'
  | 'pacifico'
  | 'courier-bold';

export const FONTS: Record<FontKey, { label: string; family: string; file: string }> = {
  'montserrat-black': {
    label: 'Heavy',
    family: 'Montserrat_900Black',
    file: '@expo-google-fonts/montserrat/900Black/Montserrat_900Black.ttf',
  },
  'montserrat-extrabold': {
    label: 'Bold',
    family: 'Montserrat_800ExtraBold',
    file: '@expo-google-fonts/montserrat/800ExtraBold/Montserrat_800ExtraBold.ttf',
  },
  'inter-semibold': {
    label: 'Clean',
    family: 'Inter_600SemiBold',
    file: '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
  },
  'poppins-bold': {
    label: 'Round',
    family: 'Poppins_700Bold',
    file: '@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf',
  },
  'playfair-bold': {
    label: 'Serif',
    family: 'PlayfairDisplay_700Bold',
    file: '@expo-google-fonts/playfair-display/700Bold/PlayfairDisplay_700Bold.ttf',
  },
  pacifico: {
    label: 'Script',
    family: 'Pacifico_400Regular',
    file: '@expo-google-fonts/pacifico/400Regular/Pacifico_400Regular.ttf',
  },
  'courier-bold': {
    label: 'Typewriter',
    family: 'CourierPrime_700Bold',
    file: '@expo-google-fonts/courier-prime/700Bold/CourierPrime_700Bold.ttf',
  },
};

/** Fonts offered for on-screen text, in picker order. */
export const TEXT_FONTS: readonly FontKey[] = ['montserrat-extrabold', 'inter-semibold', 'playfair-bold', 'pacifico', 'courier-bold'];

export const TEXT_COLORS: readonly string[] = ['#FFFFFF', '#111111', '#FE2C55', '#FFE14D', '#F5E6D3', '#A3C9A8', '#8FB8FF'];

// ---------------------------------------------------------------------------
// Safe zones: areas TikTok covers with its own UI, as fractions of the frame.
// ---------------------------------------------------------------------------

export const SAFE_ZONE = {
  /** Top bar (Following / For You). */
  top: 0.1,
  /** Caption, username and sound at the bottom. */
  bottom: 0.25,
  left: 0.05,
  /** Like / comment / share buttons down the right side. */
  right: 0.17,
} as const;

export const SAFE_RECT = {
  left: SAFE_ZONE.left,
  top: SAFE_ZONE.top,
  right: 1 - SAFE_ZONE.right,
  bottom: 1 - SAFE_ZONE.bottom,
} as const;

/**
 * Moves a box (center + half extents, all normalized) so it sits inside the
 * safe area. Boxes bigger than the area are centered in it.
 */
export function fitInSafeZone(cx: number, cy: number, halfW: number, halfH: number): { x: number; y: number } {
  const fit = (c: number, half: number, lo: number, hi: number) =>
    hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(Math.max(c, lo + half), hi - half);
  return {
    x: fit(cx, halfW, SAFE_RECT.left, SAFE_RECT.right),
    y: fit(cy, halfH, SAFE_RECT.top, SAFE_RECT.bottom),
  };
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export type CaptionStyle = 'pop' | 'minimal' | 'highlight';

export type CaptionStyleSpec = {
  label: string;
  description: string;
  font: FontKey;
  /** Font size as a fraction of frame width. */
  size: number;
  color: string;
  /** Color of the word being spoken, or null for no emphasis. */
  activeColor: string | null;
  /** Box drawn behind the word being spoken. */
  activeBackground: string | null;
  /** Dark outline for legibility on busy footage, as a fraction of font size (0 = none). */
  strokeWidth: number;
  uppercase: boolean;
  /** Pop style reveals words one at a time as they are spoken. */
  revealWords: boolean;
  maxWords: number;
  maxChars: number;
};

export const CAPTION_STYLES: Record<CaptionStyle, CaptionStyleSpec> = {
  pop: {
    label: 'Bold pop-up',
    description: 'Big words that pop in as you say them',
    font: 'montserrat-black',
    size: 0.08,
    color: '#FFFFFF',
    activeColor: '#FFE14D',
    activeBackground: null,
    strokeWidth: 0.18,
    uppercase: true,
    revealWords: true,
    maxWords: 3,
    maxChars: 16,
  },
  minimal: {
    label: 'Clean minimal',
    description: 'Simple subtitles, easy to read',
    font: 'inter-semibold',
    size: 0.05,
    color: '#FFFFFF',
    activeColor: null,
    activeBackground: null,
    strokeWidth: 0.1,
    uppercase: false,
    revealWords: false,
    maxWords: 8,
    maxChars: 34,
  },
  highlight: {
    label: 'Highlighted keyword',
    description: 'The word you’re saying gets a color box',
    font: 'poppins-bold',
    size: 0.062,
    color: '#FFFFFF',
    activeColor: '#FFFFFF',
    activeBackground: '#FE2C55',
    strokeWidth: 0.12,
    uppercase: false,
    revealWords: false,
    maxWords: 4,
    maxChars: 22,
  },
};

export type CaptionWord = { id: string; text: string; start: number; end: number };

export type Captions = {
  style: CaptionStyle;
  words: CaptionWord[];
  /** Vertical center, as a fraction of frame height. */
  y: number;
};

/** Captions wrap within this fraction of frame width, centered, clear of the side buttons. */
export const CAPTION_MAX_WIDTH = 0.66;
export const CAPTION_DEFAULT_Y = 0.66;

export type CaptionGroup = {
  words: CaptionWord[];
  start: number;
  /** When the group leaves the screen. */
  end: number;
};

const GROUP_GAP_SECONDS = 0.6;
const LINGER_SECONDS = 0.4;

export function groupCaptions(words: CaptionWord[], style: CaptionStyle): CaptionGroup[] {
  const spec = CAPTION_STYLES[style];
  const sorted = words.filter((w) => w.text.trim()).sort((a, b) => a.start - b.start);
  const groups: CaptionGroup[] = [];
  let current: CaptionWord[] = [];
  let chars = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
    chars = 0;
  };

  for (const word of sorted) {
    const prev = current[current.length - 1];
    const text = word.text.trim();
    const breakBefore =
      prev &&
      (current.length >= spec.maxWords ||
        chars + 1 + text.length > spec.maxChars ||
        word.start - prev.end > GROUP_GAP_SECONDS ||
        /[.?!]$/.test(prev.text.trim()));
    if (breakBefore) flush();
    current.push(word);
    chars += (current.length > 1 ? 1 : 0) + text.length;
  }
  flush();

  // Keep each group up a little longer, but never overlapping the next one.
  for (let i = 0; i < groups.length; i++) {
    const next = groups[i + 1];
    groups[i].end = Math.min(groups[i].end + LINGER_SECONDS, next ? next.start : Number.POSITIVE_INFINITY);
  }
  return groups;
}

export type CaptionFrame = {
  group: CaptionGroup;
  /** Index of the word being spoken (the last word that has started). */
  activeIndex: number;
};

export function captionFrameAt(groups: CaptionGroup[], t: number): CaptionFrame | null {
  const group = groups.find((g) => t >= g.start && t < g.end);
  if (!group) return null;
  let activeIndex = 0;
  group.words.forEach((w, i) => {
    if (w.start <= t) activeIndex = i;
  });
  return { group, activeIndex };
}

/** Words to draw for a frame, with the spoken one flagged. Pop style hides words not yet said. */
export function captionTokens(frame: CaptionFrame, style: CaptionStyle): { text: string; active: boolean }[] {
  const spec = CAPTION_STYLES[style];
  const visible = spec.revealWords ? frame.group.words.slice(0, frame.activeIndex + 1) : frame.group.words;
  return visible.map((w, i) => ({
    text: spec.uppercase ? w.text.trim().toUpperCase() : w.text.trim(),
    active: i === frame.activeIndex,
  }));
}

// ---------------------------------------------------------------------------
// On-screen text
// ---------------------------------------------------------------------------

export type TextOverlay = {
  id: string;
  text: string;
  font: FontKey;
  color: string;
  /** Draw a rounded box in `color` behind the text, with contrasting text. */
  background: boolean;
  /** Center, as fractions of the frame. */
  x: number;
  y: number;
  /** Font size as a fraction of frame width. */
  size: number;
  start: number;
  end: number;
};

export const TEXT_SIZES: readonly { label: string; value: number }[] = [
  { label: 'S', value: 0.05 },
  { label: 'M', value: 0.07 },
  { label: 'L', value: 0.095 },
];

export const TEXT_MAX_WIDTH = 0.7;

/**
 * Layout constants shared by the app preview and the server renderer, all as
 * multiples of the font size.
 */
export const TEXT_LAYOUT = {
  lineHeight: 1.25,
  /** Padding and corner radius of the box behind text with `background`. */
  boxPadX: 0.4,
  boxPadY: 0.2,
  boxRadius: 0.3,
  /** Soft shadow under text without a box. */
  shadowBlur: 0.12,
  /** Box behind the spoken word in "highlight" captions. */
  activePadX: 0.14,
  activePadY: 0.04,
  activeRadius: 0.18,
} as const;

/** Readable text color on top of a background color. */
export function contrastColor(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#FFFFFF';
}

// ---------------------------------------------------------------------------
// Zooms
// ---------------------------------------------------------------------------

export type Zoom = {
  id: string;
  start: number;
  end: number;
  /** 1.3 = 30% punch-in. */
  scale: number;
  /** Point to zoom toward, as fractions of the frame. */
  x: number;
  y: number;
};

export const ZOOM_STRENGTHS: readonly { label: string; value: number }[] = [
  { label: 'Subtle', value: 1.15 },
  { label: 'Medium', value: 1.3 },
  { label: 'Strong', value: 1.5 },
];

export const ZOOM_MIN_SECONDS = 0.6;

/** Ease-in/out time at each end of a zoom. */
export function zoomRamp(zoom: Zoom): number {
  return Math.min(0.25, (zoom.end - zoom.start) / 3);
}

/**
 * The visible crop at time t: scale plus the crop's top-left corner as a
 * fraction of the source frame. Identity outside any zoom.
 */
export function zoomAt(zooms: Zoom[], t: number): { scale: number; left: number; top: number } {
  const zoom = zooms.find((z) => t >= z.start && t < z.end);
  if (!zoom) return { scale: 1, left: 0, top: 0 };
  const ramp = zoomRamp(zoom);
  const u = Math.min(1, (t - zoom.start) / ramp, (zoom.end - t) / ramp);
  const eased = u * u * (3 - 2 * u);
  const scale = 1 + (zoom.scale - 1) * eased;
  const clampEdge = (focus: number) => Math.min(Math.max(focus - 0.5 / scale, 0), 1 - 1 / scale);
  return { scale, left: clampEdge(zoom.x), top: clampEdge(zoom.y) };
}

/** Sorts zooms and trims overlaps so at most one zoom is active at a time. */
export function normalizeZooms(zooms: Zoom[], duration: number): Zoom[] {
  const sorted = [...zooms]
    .map((z) => ({ ...z, start: Math.max(0, z.start), end: Math.min(duration, z.end) }))
    .sort((a, b) => a.start - b.start);
  const out: Zoom[] = [];
  for (const z of sorted) {
    const prev = out[out.length - 1];
    const start = prev ? Math.max(z.start, prev.end) : z.start;
    if (z.end - start >= ZOOM_MIN_SECONDS) out.push({ ...z, start });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole document, and what the AI suggests for it
// ---------------------------------------------------------------------------

export type OverlayDoc = {
  version: 1;
  captions: Captions | null;
  texts: TextOverlay[];
  zooms: Zoom[];
};

export const EMPTY_OVERLAYS: OverlayDoc = { version: 1, captions: null, texts: [], zooms: [] };

export function hasOverlays(doc: OverlayDoc | null | undefined): boolean {
  return Boolean(doc && ((doc.captions && doc.captions.words.length > 0) || doc.texts.length > 0 || doc.zooms.length > 0));
}

export type AiSuggestions = {
  source: 'ai' | 'heuristic';
  /** Suggested on-screen text, best first. */
  texts: { text: string; emoji: string }[];
  zooms: Omit<Zoom, 'id'>[];
};

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Captions straight from the transcript (already on the edited video's timeline). */
export function captionsFromTranscript(words: WordTiming[], style: CaptionStyle = 'pop'): Captions {
  return {
    style,
    y: CAPTION_DEFAULT_Y,
    words: words.map((w) => ({ id: newId(), text: w.word, start: w.start, end: w.end })),
  };
}

export function textFromSuggestion(s: { text: string; emoji: string }, duration: number): TextOverlay {
  return {
    id: newId(),
    text: s.emoji ? `${s.text} ${s.emoji}` : s.text,
    font: 'montserrat-extrabold',
    color: '#FFFFFF',
    background: false,
    x: 0.5,
    y: 0.2,
    size: TEXT_SIZES[1].value,
    start: 0,
    end: duration,
  };
}
