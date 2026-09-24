import { MAX_INPUT_SECONDS, PACING_OPTIONS, type EditMode, type Pacing } from '@app/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ModePicker } from '@/components/mode-picker';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VideoStatusRow } from '@/components/video-status-row';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createVideo,
  fetchRecentVideos,
  formatDuration,
  markUploadFailed,
  submitVideo,
  uploadRaw,
  withRetries,
  type PickedVideo,
  type VideoSummary,
} from '@/lib/videos';

const POLL_MS = 3000;

type Upload = { row: VideoSummary; video: PickedVideo; progress: number; failed: boolean };

export default function BatchScreen() {
  const theme = useTheme();
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [mode, setMode] = useState<EditMode>('talking');
  const [pacing, setPacing] = useState<Pacing>('natural');
  const [starting, setStarting] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [recent, setRecent] = useState<VideoSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      setRecent(await fetchRecentVideos());
    } catch (err) {
      console.warn('Could not load videos', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Poll while anything is still in progress.
  const inProgress = recent.some((v) => v.status === 'queued' || v.status === 'editing' || v.status === 'uploading');
  useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [inProgress, refresh]);

  async function pickVideo() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      // Hand over the original file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const duration = asset.duration != null ? asset.duration / 1000 : null;
    if (duration != null && duration > MAX_INPUT_SECONDS + 1) {
      Alert.alert('Video too long', 'Videos can be up to 10 minutes long. Trim it in Photos and try again.');
      return;
    }
    setPicked({
      uri: asset.uri,
      duration,
      mimeType: asset.mimeType ?? 'video/mp4',
      fileName: asset.fileName ?? null,
    });
    setThumbnail(null);
    VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500 })
      .then((t) => setThumbnail(t.uri))
      .catch(() => {});
  }

  async function runUpload(row: VideoSummary, video: PickedVideo) {
    setUpload({ row, video, progress: 0, failed: false });
    try {
      const rawPath = await withRetries(() =>
        uploadRaw(row, video, (progress) => setUpload((u) => (u && u.row.id === row.id ? { ...u, progress } : u))),
      );
      await withRetries(() => submitVideo(row.id, rawPath));
      setUpload(null);
    } catch (err) {
      console.warn('Upload failed', err);
      await markUploadFailed(row.id, 'Upload failed. Check your connection and tap Retry.').catch(() => {});
      setUpload({ row, video, progress: 0, failed: true });
    }
    refresh();
  }

  async function startEdit() {
    if (!picked) return;
    setStarting(true);
    try {
      const row = await createVideo(picked, mode, pacing);
      const video = picked;
      setPicked(null);
      setThumbnail(null);
      setRecent((r) => [row, ...r]);
      await runUpload(row, video);
    } catch (err) {
      Alert.alert("Couldn't start editing", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setStarting(false);
    }
  }

  async function retry(video: VideoSummary) {
    if (upload?.failed && upload.row.id === video.id) {
      await runUpload(upload.row, upload.video);
    } else if (video.raw_path) {
      // Upload finished but editing failed: the raw file is still on the server.
      try {
        await submitVideo(video.id, video.raw_path);
        refresh();
      } catch (err) {
        Alert.alert("Couldn't retry", err instanceof Error ? err.message : 'Please try again.');
      }
    } else {
      Alert.alert('Add it again', 'The original upload is no longer available. Add the video again to re-edit it.');
    }
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

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <ThemedText type="subtitle">Batch</ThemedText>
            <ThemedText themeColor="textSecondary">Add a video, pick a mode, and we&apos;ll edit it for you.</ThemedText>
          </View>

          {!picked ? (
            <Button title="Add Video" onPress={pickVideo} />
          ) : (
            <>
              <View style={[styles.picked, { backgroundColor: theme.backgroundElement }]}>
                {thumbnail ? (
                  <Image source={{ uri: thumbnail }} style={styles.thumbnail} contentFit="cover" />
                ) : (
                  <View style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]} />
                )}
                <View style={styles.pickedText}>
                  <ThemedText type="smallBold">Single Clip</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDuration(picked.duration)} · One video trimmed into one finished video
                  </ThemedText>
                  <Pressable onPress={() => setPicked(null)} hitSlop={8}>
                    <ThemedText type="linkPrimary">Remove</ThemedText>
                  </Pressable>
                </View>
              </View>

              <View style={styles.section}>
                <ThemedText type="smallBold">Mode</ThemedText>
                <ModePicker value={mode} onChange={setMode} />
              </View>

              {mode === 'talking' && (
                <View style={styles.section}>
                  <ThemedText type="smallBold">Pacing</ThemedText>
                  <SegmentedControl options={PACING_OPTIONS} value={pacing} onChange={setPacing} />
                </View>
              )}

              <Button title="Edit" onPress={startEdit} loading={starting} />
            </>
          )}

          {recent.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="smallBold">Recent edits</ThemedText>
              {recent.map((video) => (
                <View key={video.id} style={styles.rowWrap}>
                  <VideoStatusRow
                    video={video}
                    uploadProgress={upload && upload.row.id === video.id && !upload.failed ? upload.progress : undefined}
                    onPress={video.status === 'done' || video.status === 'failed' ? () => openVideo(video) : undefined}
                  />
                  {video.status === 'failed' && (
                    <Button title="Retry" variant="secondary" onPress={() => retry(video)} />
                  )}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.four },
  section: { gap: Spacing.two },
  picked: { flexDirection: 'row', borderRadius: 14, padding: Spacing.three, gap: Spacing.three, alignItems: 'center' },
  thumbnail: { width: 72, height: 128, borderRadius: 10 },
  pickedText: { flex: 1, gap: Spacing.one },
  rowWrap: { gap: Spacing.two },
});
