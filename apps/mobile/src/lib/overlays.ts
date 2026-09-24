import type { AiSuggestions, OverlayDoc, RenderRow, WordTiming } from '@app/shared';

import { supabase } from '@/lib/supabase';

export type EditorData = {
  transcript: WordTiming[];
  overlays: OverlayDoc | null;
  suggestions: AiSuggestions | null;
  width: number;
  height: number;
};

export async function fetchEditorData(videoId: string): Promise<EditorData> {
  const { data, error } = await supabase
    .from('videos')
    .select('transcript, overlays, ai_suggestions, output_width, output_height')
    .eq('id', videoId)
    .single();
  if (error) throw error;
  return {
    transcript: (data.transcript as WordTiming[] | null) ?? [],
    overlays: data.overlays as OverlayDoc | null,
    suggestions: data.ai_suggestions as AiSuggestions | null,
    // Videos from before Phase 2 didn't record their size; cuts are 1080x1920 by default.
    width: (data.output_width as number | null) ?? 1080,
    height: (data.output_height as number | null) ?? 1920,
  };
}

export async function saveOverlays(videoId: string, doc: OverlayDoc): Promise<void> {
  const { error } = await supabase.rpc('save_overlays', {
    p_video_id: videoId,
    p_overlays: doc,
  });
  if (error) throw error;
}

/** Saves the overlays and asks the worker to burn them into a final video. */
export async function requestRender(videoId: string, doc: OverlayDoc): Promise<string> {
  const { data, error } = await supabase.rpc('request_render', {
    p_video_id: videoId,
    p_overlays: doc,
  });
  if (error) throw error;
  return data as string;
}

export async function waitForRender(renderId: string, timeoutMs = 10 * 60_000): Promise<RenderRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data, error } = await supabase.from('renders').select('*').eq('id', renderId).single();
    if (error) throw error;
    const render = data as RenderRow;
    if (render.status === 'done') return render;
    if (render.status === 'failed') throw new Error(render.error ?? 'Saving failed. Please try again.');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('This is taking longer than expected. Please try again in a minute.');
}
