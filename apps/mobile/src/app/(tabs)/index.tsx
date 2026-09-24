import { BATCH_LIMIT, MAX_INPUT_SECONDS, type EditMode, type Pacing } from '@app/shared';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BatchCard } from '@/components/batch/batch-card';
import { DraftItem } from '@/components/batch/draft-item';
import { ModeSheet } from '@/components/batch/mode-sheet';
import { VoiceRecorder } from '@/components/batch/voice-recorder';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { newDraft, setDrafts, useDrafts, type Draft } from '@/lib/drafts';
import { draftProblem, startBatch } from '@/lib/start-batch';
import { resumePendingUploads, retryUpload, useUploadStates } from '@/lib/upload-queue';
import {
  deleteVideo,
  fetchRecentVideos,
  retryVideo,
  type PickedVideo,
  type VideoSummary,
} from '@/lib/videos';

const POLL_MS = 3000;
const BATCHES_SHOWN = 5;
/** Clips combined into one video (Multiple Clips). */
const MAX_CLIPS = 10;

/** Opens the camera roll for up to `limit` videos, turning away ones over 10 minutes. */
async function pickVideos(limit: number): Promise<PickedVideo[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
    // Hand over the original files instead of re-encoded copies.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (result.canceled) return [];
  const tooLong = result.assets.filter((a) => a.duration != null && a.duration / 1000 > MAX_INPUT_SECONDS + 1);
  if (tooLong.length) {
    Alert.alert(
      tooLong.length === 1 ? '1 video is too long' : `${tooLong.length} videos are too long`,
      'Videos can be up to 10 minutes long. Trim them in Photos and add them again.',
    );
  }
  return result.assets
    .filter((a) => !tooLong.includes(a))
    .slice(0, limit)
    .map((a) => ({
      uri: a.uri,
      duration: a.duration != null ? a.duration / 1000 : null,
      mimeType: a.mimeType ?? 'video/mp4',
      fileName: a.fileName ?? null,
    }));
}

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
  const drafts = useDrafts();
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [starting, setStarting] = useState(false);
  const [recent, setRecent] = useState<VideoSummary[]>([]);
  const [recordingFor, setRecordingFor] = useState<string | null>(null);

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

  function withThumbnails(added: Draft[]) {
    for (const draft of added) {
      VideoThumbnails.getThumbnailAsync(draft.clips[0].uri, { time: 500 })
        .then((t) => setDrafts((d) => d.map((x) => (x.key === draft.key ? { ...x, thumbnail: t.uri } : x))))
        .catch(() => {});
    }
  }

  async function addVideos() {
    // Up to 10 separate videos, or up to 10 clips combined into one.
    const picked = await pickVideos(Math.max(remaining, MAX_CLIPS));
    if (picked.length === 0) return;
    const last = drafts[drafts.length - 1];
    const add = (added: Draft[]) => {
      setDrafts((d) => [...d, ...added]);
      withThumbnails(added);
    };
    if (picked.length === 1) return add([newDraft(picked, last)]);

    const separate = () => {
      if (picked.length > remaining) {
        Alert.alert(
          'Batch is full',
          `Only ${remaining} more ${remaining === 1 ? 'video fits' : 'videos fit'} in this batch.`,
        );
      }
      add(picked.slice(0, remaining).map((clip) => newDraft([clip], last)));
    };
    if (remaining === 0) {
      Alert.alert('Batch is full', `A batch holds ${BATCH_LIMIT} videos.`);
      return;
    }
    Alert.alert(`${picked.length} videos selected`, 'Edit them as separate videos, or combine them into one?', [
      { text: 'Separate videos', onPress: separate },
      { text: 'Combine into one', onPress: () => add([newDraft(picked, last)]) },
    ]);
  }

  async function addClips(key: string) {
    const draft = drafts.find((d) => d.key === key);
    if (!draft) return;
    const picked = await pickVideos(MAX_CLIPS - draft.clips.length);
    if (picked.length) setDrafts((d) => d.map((x) => (x.key === key ? { ...x, clips: [...x.clips, ...picked] } : x)));
  }

  function split(key: string) {
    const index = drafts.findIndex((d) => d.key === key);
    const draft = drafts[index];
    if (!draft) return;
    const room = remaining + 1;
    if (draft.clips.length > room) {
      Alert.alert('Not enough room', `Only ${room} ${room === 1 ? 'video fits' : 'videos fit'} in this batch.`);
      return;
    }
    const parts = draft.clips.map((clip) => newDraft([clip], draft));
    setDrafts((d) => [...d.slice(0, index), ...parts, ...d.slice(index + 1)]);
    withThumbnails(parts);
  }

  const setVoice = (key: string, voice: PickedVideo | null) =>
    setDrafts((d) => d.map((x) => (x.key === key ? { ...x, voice } : x)));

  async function pickVoice(key: string) {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setVoice(key, { uri: asset.uri, duration: null, mimeType: asset.mimeType ?? 'audio/mp4', fileName: asset.name });
  }

  function applySheet(mode: EditMode, pacing: Pacing) {
    if (!sheet) return;
    setDrafts((d) => d.map((x) => (sheet.kind === 'all' || x.key === sheet.key ? { ...x, mode, pacing } : x)));
    setSheet(null);
  }

  async function start() {
    if (!session || drafts.length === 0) return;
    const problem = draftProblem(drafts);
    if (problem) {
      Alert.alert(problem.title, problem.message);
      return;
    }
    setStarting(true);
    try {
      const rows = await startBatch(drafts);
      setDrafts([]);
      setRecent((r) => [...rows, ...r]);
    } catch (err) {
      Alert.alert("Couldn't start editing", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function retry(video: VideoSummary) {
    try {
      // Everything already on the server (e.g. the edit failed): just re-queue it.
      if (await retryVideo(video.id)) {
        refresh();
        return;
      }
    } catch (err) {
      Alert.alert("Couldn't retry", err instanceof Error ? err.message : 'Please try again.');
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
                  clips={draft.clips}
                  voice={draft.voice}
                  mode={draft.mode}
                  pacing={draft.pacing}
                  canAddClips={draft.clips.length < MAX_CLIPS}
                  onPickMode={() => setSheet({ kind: 'item', key: draft.key })}
                  onAddClips={() => addClips(draft.key)}
                  onSplit={() => split(draft.key)}
                  onRecordVoice={() => setRecordingFor(draft.key)}
                  onPickVoice={() => pickVoice(draft.key)}
                  onRemoveVoice={() => setVoice(draft.key, null)}
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
              onPress={start}
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
      {recordingFor && (
        <VoiceRecorder
          onDone={(voice) => {
            setVoice(recordingFor, voice);
            setRecordingFor(null);
          }}
          onCancel={() => setRecordingFor(null)}
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
