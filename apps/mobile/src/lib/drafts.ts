import type { EditMode, Pacing } from '@app/shared';
import { useSyncExternalStore } from 'react';

import type { PickedVideo } from '@/lib/videos';

/**
 * Videos waiting to be edited. Shared by the Batch tab and the Create tab, so
 * a recording made in the camera shows up in the batch without hunting for it.
 */
export type Draft = {
  key: string;
  /** One clip = Single Clip; more = Multiple Clips. */
  clips: PickedVideo[];
  voice: PickedVideo | null;
  thumbnail: string | null;
  mode: EditMode;
  pacing: Pacing;
};

let drafts: Draft[] = [];
const listeners = new Set<() => void>();

export function setDrafts(update: Draft[] | ((current: Draft[]) => Draft[])) {
  drafts = typeof update === 'function' ? update(drafts) : update;
  listeners.forEach((l) => l());
}

export function getDrafts(): Draft[] {
  return drafts;
}

export function useDrafts(): Draft[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => drafts,
  );
}

let counter = 0;

export function newDraft(clips: PickedVideo[], like?: Pick<Draft, 'mode' | 'pacing'>): Draft {
  // New videos start with the mode of the last one, so "Set all" is rarely needed.
  return {
    key: `draft-${Date.now()}-${counter++}`,
    clips,
    voice: null,
    thumbnail: null,
    mode: like?.mode ?? 'talking',
    pacing: like?.pacing ?? 'natural',
  };
}

/** Seconds of footage in a draft, or null if a clip's length is unknown. */
export function draftDuration(draft: Draft): number | null {
  return draft.clips.every((c) => c.duration != null) ? draft.clips.reduce((s, c) => s + (c.duration ?? 0), 0) : null;
}
