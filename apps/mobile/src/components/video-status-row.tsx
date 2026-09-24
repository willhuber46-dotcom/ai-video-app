import { getMode, type VideoStatus } from '@app/shared';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, type VideoSummary } from '@/lib/videos';

const LABELS: Record<VideoStatus, string> = {
  uploading: 'Uploading',
  queued: 'Waiting to edit',
  editing: 'Editing',
  done: 'Done',
  failed: 'Failed',
};

export function VideoStatusRow({
  video,
  uploadProgress,
  onPress,
}: {
  video: VideoSummary;
  /** 0–1 while this device is uploading the video. */
  uploadProgress?: number;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const working = video.status === 'uploading' || video.status === 'queued' || video.status === 'editing';
  const statusColor =
    video.status === 'done' ? theme.success : video.status === 'failed' ? theme.danger : theme.textSecondary;
  let label = LABELS[video.status];
  if (video.status === 'uploading' && uploadProgress != null) label += ` ${Math.round(uploadProgress * 100)}%`;

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 }]}>
      <View style={styles.text}>
        <ThemedText type="smallBold">{getMode(video.mode).name}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {video.status === 'done'
            ? `${formatDuration(video.source_duration_s)} → ${formatDuration(video.output_duration_s)}`
            : video.status === 'failed' && video.error
              ? video.error
              : new Date(video.created_at).toLocaleString()}
        </ThemedText>
      </View>
      <View style={styles.status}>
        {working && <ActivityIndicator size="small" />}
        <ThemedText type="smallBold" style={{ color: statusColor }}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  text: { flex: 1, gap: Spacing.half },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
});
