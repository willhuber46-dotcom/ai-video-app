import { batchProgressLabel, summarizeBatch } from '@app/shared';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { VideoStatusRow } from '@/components/video-status-row';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { UploadState } from '@/lib/upload-queue';
import type { VideoSummary } from '@/lib/videos';

/** A batch's overall progress ("3 of 10 done") and a live row per video. */
export function BatchCard({
  videos,
  uploads,
  onOpen,
  onRetry,
}: {
  videos: VideoSummary[];
  uploads: ReadonlyMap<string, UploadState>;
  onOpen: (video: VideoSummary) => void;
  onRetry: (video: VideoSummary) => void;
}) {
  const theme = useTheme();
  const summary = summarizeBatch(videos.map((v) => v.status));
  const fraction = summary.total ? (summary.done + summary.failed) / summary.total : 0;
  const created = new Date(videos[0].created_at);

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{batchProgressLabel(summary)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
          {created.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </ThemedText>
      </View>
      {!summary.finished && (
        <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: theme.accent }]} />
        </View>
      )}
      {!summary.finished && (
        <ThemedText type="small" themeColor="textSecondary">
          You can leave the app. We’ll send a notification when {summary.total === 1 ? 'it’s' : 'they’re all'} ready.
        </ThemedText>
      )}
      {videos.map((video) => {
        const upload = uploads.get(video.id);
        // An upload row with nothing sending it on this device has stalled.
        const stalled = video.status === 'uploading' && !upload;
        return (
          <View key={video.id} style={styles.rowWrap}>
            <VideoStatusRow
              video={video}
              uploadProgress={upload && !upload.failed ? upload.progress : undefined}
              stalled={stalled}
              onPress={video.status === 'done' || video.status === 'failed' ? () => onOpen(video) : undefined}
            />
            {(video.status === 'failed' || stalled) && (
              <Button title="Retry" variant="secondary" onPress={() => onRetry(video)} />
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  rowWrap: { gap: Spacing.two },
});
