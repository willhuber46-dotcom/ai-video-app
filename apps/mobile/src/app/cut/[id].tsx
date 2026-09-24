import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchVideo, formatDuration, signedCutUrl, type VideoSummary } from '@/lib/videos';

export default function PreviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [video, setVideo] = useState<VideoSummary | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    (async () => {
      try {
        const row = await fetchVideo(id);
        setVideo(row);
        if (!row.output_path) throw new Error('This video is not ready yet.');
        setUrl(await signedCutUrl(row.output_path));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load this video.');
      }
    })();
  }, [id]);

  async function saveToCameraRoll() {
    if (!video?.output_path) return;
    setSaving(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) {
        Alert.alert('Allow access to Photos', 'We need permission to save videos to your camera roll.');
        return;
      }
      // Fresh URL so a long-open preview doesn't hit an expired link.
      const downloadUrl = await signedCutUrl(video.output_path, 600);
      const file = await File.downloadFileAsync(downloadUrl, new File(Paths.cache, `${video.id}.mp4`), {
        idempotent: true,
      });
      await MediaLibrary.Asset.create(file.uri);
      file.delete();
      Alert.alert('Saved', 'Your video is in your camera roll, ready to post.');
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">{error}</ThemedText>
      </ThemedView>
    );
  }

  const removed = video?.edit_decisions?.removed;

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.playerFrame, { backgroundColor: theme.backgroundElement }]}>
            {url ? (
              <VideoView player={player} style={styles.player} contentFit="contain" nativeControls />
            ) : (
              <ActivityIndicator style={styles.flex} />
            )}
          </View>

          {video && (
            <View style={styles.stats}>
              <ThemedText type="smallBold">
                {formatDuration(video.source_duration_s)} → {formatDuration(video.output_duration_s)}
              </ThemedText>
              {removed && (
                <ThemedText type="small" themeColor="textSecondary">
                  Cut {formatDuration(removed.seconds)} of pauses and dead air
                  {removed.retakeSentences + removed.restarts > 0
                    ? `, ${removed.retakeSentences + removed.restarts} retake${removed.retakeSentences + removed.restarts === 1 ? '' : 's'}`
                    : ''}
                  {removed.fillerWords > 0 ? `, ${removed.fillerWords} filler word${removed.fillerWords === 1 ? '' : 's'}` : ''}.
                </ThemedText>
              )}
            </View>
          )}

          <Button title="Save to camera roll" onPress={saveToCameraRoll} loading={saving} disabled={!url} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.four, gap: Spacing.three },
  playerFrame: { width: '100%', aspectRatio: 9 / 16, borderRadius: 16, overflow: 'hidden' },
  player: { flex: 1 },
  stats: { gap: Spacing.one },
});
