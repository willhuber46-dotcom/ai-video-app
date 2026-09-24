import { BATCH_LIMIT, getMode, MAX_INPUT_SECONDS, type EditMode, type Pacing } from '@app/shared';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BatchCard } from '@/components/batch/batch-card';
import { DraftItem } from '@/components/batch/draft-item';
import { ModeSheet } from '@/components/batch/mode-sheet';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { registerForPushNotifications } from '@/lib/notifications';
import { enqueueUploads, resumePendingUploads, retryUpload, useUploadStates } from '@/lib/upload-queue';
import {
  createBatch,
  deleteVideo,
  fetchRecentVideos,
  submitVideo,
  type PickedVideo,
  type VideoSummary,
} from '@/lib/videos';

const POLL_MS = 3000;
const BATCHES_SHOWN = 5;

type Draft = {
  key: string;
  video: PickedVideo;
  thumbnail: string | null;
  mode: EditMode;
  pacing: Pacing;
};

/** Which draft the mode sheet is editing, or 'all' for "Set all to...". */
type SheetTarget = { kind: 'all' } | { kind: 'item'; key: string };

/** Groups videos by batch, newest batch first, keeping upload order inside each. */
function groupByBatch(videos: VideoSummary[]): VideoSummary[][] {
  const groups = new Map<string, VideoSummary[]>();
  for (const v of videos) {
    const key = v.batch_id ?? v.id;
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  return [...groups.values()]
    .map((g) => g.sort((a, b) => a.created_at.localeCompare(b.created_at)))
    .sort((a, b) => b[0].created_at.localeCompare(a[0].created_at));
}

export default function BatchScreen() {
  const { session } = useAuth();
  const uploads = useUploadStates();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [starting, setStarting] = useState(false);
  const [recent, setRecent] = useState<VideoSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const videos = await fetchRecentVideos();
      setRecent(videos);
      return videos;
    } catch (err) {
      console.warn('Could not load videos', err);
      return null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Pick up any uploads that were cut off when the app was closed.
      refresh().then((videos) => videos && resumePendingUploads(videos));
    }, [refresh]),
  );

  // Poll while anything is still uploading or editing.
  const inProgress = recent.some((v) => v.status === 'uploading' || v.status === 'queued' || v.status === 'editing');
  useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [inProgress, refresh]);

  const remaining = BATCH_LIMIT - drafts.length;

  async function addVideos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      orderedSelection: true,
      // Hand over the original files instead of re-encoded copies.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled) return;

    const tooLong = result.assets.filter((a) => a.duration != null && a.duration / 1000 > MAX_INPUT_SECONDS + 1);
    const accepted = result.assets.filter((a) => !tooLong.includes(a)).slice(0, remaining);
    if (tooLong.length) {
      Alert.alert(
        tooLong.length === 1 ? '1 video is too long' : `${tooLong.length} videos are too long`,
        'Videos can be up to 10 minutes long. Trim them in Photos and add them again.',
      );
    }
    // New videos start with the mode of the last one, so "Set all" is rarely needed.
    const last = drafts[drafts.length - 1];
    const added: Draft[] = accepted.map((asset, i) => ({
      key: `${Date.now()}-${i}-${asset.uri}`,
      video: {
        uri: asset.uri,
        duration: asset.duration != null ? asset.duration / 1000 : null,
        mimeType: asset.mimeType ?? 'video/mp4',
        fileName: asset.fileName ?? null,
      },
      thumbnail: null,
      mode: last?.mode ?? 'talking',
      pacing: last?.pacing ?? 'natural',
    }));
    setDrafts((d) => [...d, ...added]);

    for (const draft of added) {
      VideoThumbnails.getThumbnailAsync(draft.video.uri, { time: 500 })
        .then((t) => setDrafts((d) => d.map((x) => (x.key === draft.key ? { ...x, thumbnail: t.uri } : x))))
        .catch(() => {});
    }
  }

  function applySheet(mode: EditMode, pacing: Pacing) {
    if (!sheet) return;
    setDrafts((d) => d.map((x) => (sheet.kind === 'all' || x.key === sheet.key ? { ...x, mode, pacing } : x)));
    setSheet(null);
  }

  async function startBatch() {
    if (!session || drafts.length === 0) return;
    const unavailable = drafts.filter((d) => !getMode(d.mode).available);
    if (unavailable.length) {
      Alert.alert('Mode coming soon', `${getMode(unavailable[0].mode).name} isn’t available yet. Pick another mode.`);
      return;
    }
    setStarting(true);
    try {
      // Ask once, at the moment it's useful: so we can say when the batch is done.
      void registerForPushNotifications({ prompt: true });
      const rows = await createBatch(drafts.map((d) => ({ video: d.video, mode: d.mode, pacing: d.pacing })));
      await enqueueUploads(rows.map((row, i) => ({ videoId: row.id, userId: row.user_id, video: drafts[i].video })));
      setDrafts([]);
      setRecent((r) => [...rows, ...r]);
    } catch (err) {
      Alert.alert("Couldn't start editing", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function retry(video: VideoSummary) {
    if (video.raw_path && video.status === 'failed') {
      // Upload finished but editing failed: the raw file is still on the server.
      try {
        await submitVideo(video.id, video.raw_path);
        refresh();
      } catch (err) {
        Alert.alert("Couldn't retry", err instanceof Error ? err.message : 'Please try again.');
      }
      return;
    }
    if (await retryUpload(video.id)) return;
    Alert.alert('Add it again', 'The original video isn’t available on this phone anymore. Add it to a new batch.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => deleteVideo(video.id).then(refresh),
      },
    ]);
  }

  function openVideo(video: VideoSummary) {
    if (video.status === 'done') router.push({ pathname: '/cut/[id]', params: { id: video.id } });
    else if (video.status === 'failed') {
      Alert.alert('Editing failed', video.error ?? 'Something went wrong.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => retry(video) },
      ]);
    }
  }

  const batches = groupByBatch(recent).slice(0, BATCHES_SHOWN);
  const sheetDraft = sheet?.kind === 'item' ? drafts.find((d) => d.key === sheet.key) : drafts[0];

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <ThemedText type="subtitle">Batch</ThemedText>
            <ThemedText themeColor="textSecondary">
              Add up to {BATCH_LIMIT} videos, pick a mode for each, and we&apos;ll edit them all at once.
            </ThemedText>
          </View>

          {drafts.length > 0 && (
            <View style={styles.section}>
              <View style={styles.row}>
                <ThemedText type="smallBold">
                  {drafts.length} of {BATCH_LIMIT} videos
                </ThemedText>
                {drafts.length > 1 && (
                  <Button title="Set all to…" variant="secondary" onPress={() => setSheet({ kind: 'all' })} />
                )}
              </View>
              {drafts.map((draft, i) => (
                <DraftItem
                  key={draft.key}
                  index={i}
                  thumbnail={draft.thumbnail}
                  duration={draft.video.duration}
                  mode={draft.mode}
                  pacing={draft.pacing}
                  onPickMode={() => setSheet({ kind: 'item', key: draft.key })}
                  onRemove={() => setDrafts((d) => d.filter((x) => x.key !== draft.key))}
                />
              ))}
            </View>
          )}

          {remaining > 0 && (
            <Button
              title={drafts.length ? 'Add more videos' : 'Add Videos'}
              variant={drafts.length ? 'secondary' : 'primary'}
              onPress={addVideos}
            />
          )}
          {drafts.length > 0 && (
            <Button
              title={drafts.length === 1 ? 'Edit 1 video' : `Edit ${drafts.length} videos`}
              onPress={startBatch}
              loading={starting}
            />
          )}

          {batches.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="smallBold">Recent batches</ThemedText>
              {batches.map((videos) => (
                <BatchCard
                  key={videos[0].batch_id ?? videos[0].id}
                  videos={videos}
                  uploads={uploads}
                  onOpen={openVideo}
                  onRetry={retry}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {sheet && sheetDraft && (
        <ModeSheet
          visible
          title={sheet.kind === 'all' ? 'Set all videos to…' : 'Edit mode'}
          initialMode={sheetDraft.mode}
          initialPacing={sheetDraft.pacing}
          onDone={applySheet}
          onCancel={() => setSheet(null)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.four },
  section: { gap: Spacing.two },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
