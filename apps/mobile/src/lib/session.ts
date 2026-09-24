import { Image } from 'expo-image';
import { Directory, File, Paths } from 'expo-file-system';

import { unregisterPushNotifications } from '@/lib/notifications';
import { requestAccountDeletion } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { clearPendingUploads, pendingUploadCount } from '@/lib/upload-queue';

/** Stops pushes to this phone for this account, forgets local uploads, signs out. */
export async function signOut(): Promise<void> {
  await unregisterPushNotifications().catch(() => {});
  await clearPendingUploads();
  await supabase.auth.signOut();
}

/** Files the deletion request, then signs out. The server removes all data within minutes. */
export async function deleteAccount(): Promise<void> {
  await requestAccountDeletion();
  await clearPendingUploads();
  await supabase.auth.signOut();
}

/**
 * "Refresh app data / clear storage": clears cached thumbnails, downloaded
 * videos and picked-video copies. Refuses while uploads still need those files.
 */
export async function clearAppStorage(): Promise<'cleared' | 'uploads-pending'> {
  if ((await pendingUploadCount()) > 0) return 'uploads-pending';
  await Image.clearMemoryCache();
  await Image.clearDiskCache();
  for (const item of Paths.cache.list()) {
    try {
      if (item instanceof File || item instanceof Directory) item.delete();
    } catch (err) {
      console.warn(`Could not delete ${item.uri}`, err);
    }
  }
  return 'cleared';
}
