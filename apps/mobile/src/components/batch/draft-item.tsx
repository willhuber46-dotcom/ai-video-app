import { getMode, PACING_OPTIONS, usesPacing, type EditMode, type Pacing } from '@app/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, type PickedVideo } from '@/lib/videos';

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <ThemedText type="linkPrimary">{label}</ThemedText>
    </Pressable>
  );
}

/**
 * One video waiting to be edited: thumbnail, clip type (Single or Multiple
 * Clips), its own mode picker, and the voice recording for Voiceover Mode.
 */
export function DraftItem({
  index,
  thumbnail,
  clips,
  voice,
  mode,
  pacing,
  canAddClips,
  onPickMode,
  onAddClips,
  onSplit,
  onRecordVoice,
  onPickVoice,
  onRemoveVoice,
  onRemove,
}: {
  index: number;
  thumbnail: string | null;
  clips: PickedVideo[];
  voice: PickedVideo | null;
  mode: EditMode;
  pacing: Pacing;
  canAddClips: boolean;
  onPickMode: () => void;
  onAddClips: () => void;
  onSplit: () => void;
  onRecordVoice: () => void;
  onPickVoice: () => void;
  onRemoveVoice: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const pacingLabel = PACING_OPTIONS.find((p) => p.key === pacing)?.label;
  const known = clips.every((c) => c.duration != null);
  const total = clips.reduce((s, c) => s + (c.duration ?? 0), 0);
  const multiple = clips.length > 1;

  return (
    <View style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.top}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbnail} contentFit="cover" />
        ) : (
          <View style={[styles.thumbnail, { backgroundColor: theme.backgroundSelected }]} />
        )}
        <View style={styles.body}>
          <ThemedText type="smallBold">
            Video {index + 1} · {known ? formatDuration(total) : '–'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {multiple ? `Multiple Clips · ${clips.length} clips` : 'Single Clip'}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Choose how this video is edited"
            onPress={onPickMode}
            style={({ pressed }) => [styles.mode, { backgroundColor: theme.background, opacity: pressed ? 0.7 : 1 }]}>
            <ThemedText type="small">
              {getMode(mode).name}
              {usesPacing(mode) ? ` · ${pacingLabel}` : ''} ▾
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

      <View style={styles.links}>
        {canAddClips && <Link label="+ Add clips" onPress={onAddClips} />}
        {multiple && <Link label="Split into separate videos" onPress={onSplit} />}
      </View>

      {mode === 'voiceover' && (
        <View style={[styles.voice, { borderColor: theme.border }]}>
          {voice ? (
            <>
              <ThemedText type="small" style={styles.flex}>
                🎙 Voice added{voice.duration != null ? ` · ${formatDuration(voice.duration)}` : ''}
              </ThemedText>
              <Link label="Remove" onPress={onRemoveVoice} />
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
                🎙 Needs a voice recording
              </ThemedText>
              <Link label="Record" onPress={onRecordVoice} />
              <Link label="Choose file" onPress={onPickVoice} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  item: { borderRadius: 14, padding: Spacing.two, gap: Spacing.two },
  top: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  thumbnail: { width: 54, height: 96, borderRadius: 8 },
  body: { flex: 1, gap: Spacing.one, alignItems: 'flex-start' },
  mode: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, marginTop: Spacing.one },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four, paddingHorizontal: Spacing.one },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
});
