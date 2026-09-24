import { expiryWarning, getMode } from '@app/shared';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { Cut } from '@/lib/cuts';
import { formatDuration } from '@/lib/videos';

/** One finished edit in the grid: thumbnail, mode, length and an expiry warning. */
export function CutTile({
  cut,
  thumbnail,
  size,
  selecting,
  selected,
  onPress,
  onLongPress,
}: {
  cut: Cut;
  thumbnail: string | undefined;
  size: number;
  selecting: boolean;
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const warning = expiryWarning(cut.expires_at);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${getMode(cut.mode).name}, ${formatDuration(cut.output_duration_s)}${warning ? `, ${warning}` : ''}`}
      accessibilityState={selecting ? { selected } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tile, { width: size, height: (size * 16) / 9, backgroundColor: theme.backgroundElement }]}>
      {thumbnail && <Image source={{ uri: thumbnail }} style={StyleSheet.absoluteFill} contentFit="cover" />}
      {warning && (
        <View style={[styles.warning, { backgroundColor: theme.danger }]}>
          <Text style={styles.warningText}>{warning}</Text>
        </View>
      )}
      <View style={styles.footer}>
        <Text style={styles.badge} numberOfLines={1}>
          {getMode(cut.mode).shortName}
        </Text>
        <Text style={styles.badge}>{formatDuration(cut.output_duration_s)}</Text>
      </View>
      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          <SymbolView
            name={{
              ios: selected ? 'checkmark.circle.fill' : 'circle',
              android: selected ? 'check_circle' : 'radio_button_unchecked',
            }}
            size={24}
            tintColor={selected ? theme.accent : '#ffffff'}
          />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 10, overflow: 'hidden' },
  warning: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    borderRadius: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  warningText: { color: '#fff', fontSize: 11, fontWeight: 700 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  badge: { color: '#fff', fontSize: 11, fontWeight: 600, flexShrink: 1 },
  check: { position: 'absolute', top: 6, right: 6, borderRadius: 12 },
  checkOn: { backgroundColor: '#fff' },
});
