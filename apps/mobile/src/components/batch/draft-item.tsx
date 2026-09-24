import { getMode, PACING_OPTIONS, type EditMode, type Pacing } from '@app/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration } from '@/lib/videos';

/** One video waiting to be edited: thumbnail, clip type, its own mode picker. */
export function DraftItem({
  index,
  thumbnail,
  duration,
  mode,
  pacing,
  onPickMode,
  onRemove,
}: {
  index: number;
  thumbnail: string | null;
  duration: number | null;
  mode: EditMode;
  pacing: Pacing;
  onPickMode: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const pacingLabel = PACING_OPTIONS.find((p) => p.key === pacing)?.label;

  return (
    <View style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
      {thumbnail ? (
        <Image source={{ uri: thumbnail }} style={styles.thumbnail} contentFit="cover" />
      ) : (
        <View style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]} />
      )}
      <View style={styles.body}>
        <ThemedText type="smallBold">
          Video {index + 1} · {formatDuration(duration)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Single Clip
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Choose how this video is edited"
          onPress={onPickMode}
          style={({ pressed }) => [styles.mode, { backgroundColor: theme.background, opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="small">
            {getMode(mode).name}
            {mode === 'talking' ? ` · ${pacingLabel}` : ''} ▾
          </ThemedText>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove video ${index + 1}`}
        onPress={onRemove}
        hitSlop={10}>
        <ThemedText themeColor="textSecondary">✕</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', borderRadius: 14, padding: Spacing.two, gap: Spacing.three, alignItems: 'center' },
  thumbnail: { width: 54, height: 96, borderRadius: 8 },
  body: { flex: 1, gap: Spacing.one, alignItems: 'flex-start' },
  mode: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, marginTop: Spacing.one },
});
