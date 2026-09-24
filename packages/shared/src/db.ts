import type { ClipType, EditMode, Pacing } from './modes';
import type { AiSuggestions, OverlayDoc } from './overlays';

/**
 * Lifecycle of one video:
 * uploading (app is sending the raw file) -> queued (waiting for a worker)
 * -> editing (worker is cutting it) -> done | failed.
 */
export type VideoStatus = 'uploading' | 'queued' | 'editing' | 'done' | 'failed';

export const STORAGE_BUCKETS = {
  raw: 'raw-uploads',
  cuts: 'cuts',
} as const;

/** Max length of one input video, in seconds (one credit covers up to 10 minutes). */
export const MAX_INPUT_SECONDS = 10 * 60;

/** Finished cuts are kept for this many days, then auto-deleted. */
export const CUT_RETENTION_DAYS = 30;

export type WordTiming = {
  word: string;
  start: number;
  end: number;
};

/** A kept range of the source video, in seconds. */
export type KeepRange = { start: number; end: number };

export type EditDecisions = {
  pacing: Pacing;
  keep: KeepRange[];
  removed: {
    /** Total seconds cut from the source (pauses, fillers, retakes). */
    seconds: number;
    fillerWords: number;
    retakeSentences: number;
    restarts: number;
  };
  /** Who decided which sentences were retakes. */
  retakeSource: 'ai' | 'heuristic' | 'none';
  /** 'transcript' normally; 'silence' when no speech was found and we cut on audio levels. */
  cutSource: 'transcript' | 'silence';
};

export type VideoRow = {
  id: string;
  user_id: string;
  batch_id: string | null;
  mode: EditMode;
  clip_type: ClipType;
  pacing: Pacing;
  status: VideoStatus;
  error: string | null;
  raw_path: string | null;
  source_duration_s: number | null;
  output_path: string | null;
  thumbnail_path: string | null;
  output_duration_s: number | null;
  output_width: number | null;
  output_height: number | null;
  transcript: WordTiming[] | null;
  edit_decisions: EditDecisions | null;
  /** The user's captions, text and zooms (Phase 2). */
  overlays: OverlayDoc | null;
  ai_suggestions: AiSuggestions | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
};

export type RenderStatus = 'queued' | 'rendering' | 'done' | 'failed';

/** A request to burn a video's overlays into a final MP4. */
export type RenderRow = {
  id: string;
  video_id: string;
  user_id: string;
  overlays: OverlayDoc;
  status: RenderStatus;
  error: string | null;
  output_path: string | null;
  attempts: number;
  created_at: string;
  completed_at: string | null;
};

export type ProfileRow = {
  id: string;
  display_name: string | null;
  record_language: string;
  created_at: string;
};
