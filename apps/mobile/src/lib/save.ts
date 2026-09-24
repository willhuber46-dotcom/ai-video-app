import { hasOverlays, type OverlayDoc } from '@app/shared';
import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

import { requestRender, waitForRender } from '@/lib/overlays';
import { signedCutUrl } from '@/lib/videos';

export type SaveStage = 'preparing' | 'downloading';

/** Asks for write access to Photos. Returns false if the user says no. */
export async function ensurePhotosPermission(): Promise<boolean> {
  return (await MediaLibrary.requestPermissionsAsync(true)).granted;
}

/**
 * Saves a cut to the camera roll. With captions, text or zooms, the worker
 * first burns them in ("preparing"); otherwise the cut is downloaded as is.
 * Call ensurePhotosPermission() first.
 */
export async function saveCutToCameraRoll(
  cut: { id: string; outputPath: string; overlays: OverlayDoc | null },
  onStage?: (stage: SaveStage) => void,
): Promise<void> {
  let path = cut.outputPath;
  if (cut.overlays && hasOverlays(cut.overlays)) {
    onStage?.('preparing');
    const render = await waitForRender(await requestRender(cut.id, cut.overlays));
    path = render.output_path!;
  }
  onStage?.('downloading');
  const file = await File.downloadFileAsync(await signedCutUrl(path, 600), new File(Paths.cache, `${cut.id}.mp4`), {
    idempotent: true,
  });
  try {
    await MediaLibrary.Asset.create(file.uri);
  } finally {
    file.delete();
  }
}
