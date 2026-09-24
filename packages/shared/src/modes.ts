export type EditMode = 'talking' | 'no_talking' | 'voiceover' | 'before_after' | 'unboxing_asmr';

export type ClipType = 'single' | 'multiple';

export type ModeInfo = {
  key: EditMode;
  name: string;
  /** Fits on a thumbnail badge. */
  shortName: string;
  /** Shown in the mode picker so users understand what the mode does. */
  description: string;
  /** Extra note shown under the description, e.g. for modes that ignore audio. */
  note?: string;
  bestClipType: ClipType;
  /** Modes ship in phases; unavailable ones are shown as "Coming soon". */
  available: boolean;
};

export const MODES: readonly ModeInfo[] = [
  {
    key: 'talking',
    name: 'Talking Mode',
    shortName: 'Talking',
    description:
      'For videos where you talk to the camera. We cut out the pauses, dead air, and retakes so only your best parts stay in.',
    bestClipType: 'single',
    available: true,
  },
  {
    key: 'no_talking',
    name: 'No Talking Mode',
    shortName: 'No Talking',
    description:
      "For videos where you're just showing off a product, like outfits, home decor, or gadgets. We ignore the audio and cut to your best angles and moments.",
    note: "This mode doesn't use audio.",
    bestClipType: 'multiple',
    available: false,
  },
  {
    key: 'voiceover',
    name: 'Voiceover Mode',
    shortName: 'Voiceover',
    description:
      'Film your product clips, then record your voice separately. We match your clips to what you’re saying.',
    bestClipType: 'multiple',
    available: false,
  },
  {
    key: 'before_after',
    name: 'Before & After Mode',
    shortName: 'Before & After',
    description:
      'For transformations like cleaning, beauty, hair, or organizing. We find your before and after moments and add a smooth transition between them.',
    bestClipType: 'multiple',
    available: false,
  },
  {
    key: 'unboxing_asmr',
    name: 'Unboxing / ASMR Mode',
    shortName: 'Unboxing',
    description:
      'For unboxings and satisfying product videos. We keep the good sounds (tearing, clicking, pouring) and cut the slow parts.',
    bestClipType: 'multiple',
    available: false,
  },
];

export function getMode(key: EditMode): ModeInfo {
  const mode = MODES.find((m) => m.key === key);
  if (!mode) throw new Error(`Unknown mode: ${key}`);
  return mode;
}

export type Pacing = 'tight' | 'natural' | 'loose';

export const PACING_OPTIONS: readonly { key: Pacing; label: string }[] = [
  { key: 'tight', label: 'Tight' },
  { key: 'natural', label: 'Natural' },
  { key: 'loose', label: 'Loose' },
];
