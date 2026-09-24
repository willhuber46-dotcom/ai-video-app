import { FONTS, TEXT_COLORS, TEXT_FONTS, TEXT_SIZES, type AiSuggestions, type TextOverlay } from '@app/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/editor/chip';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { fontFamily } from '@/constants/fonts';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const FIRST_SECONDS = 3;

export function TextPanel({
  texts,
  selectedId,
  suggestions,
  duration,
  time,
  onSelect,
  onChange,
  onAdd,
  onDelete,
}: {
  texts: TextOverlay[];
  selectedId: string | null;
  suggestions: AiSuggestions['texts'];
  duration: number;
  time: number;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<TextOverlay>) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  const theme = useTheme();
  const selected = texts.find((t) => t.id === selectedId) ?? null;
  const patch = (p: Partial<TextOverlay>) => selected && onChange(selected.id, p);

  const timing =
    selected == null
      ? null
      : selected.start <= 0.01 && selected.end >= duration - 0.01
        ? 'all'
        : selected.start <= 0.01 && Math.abs(selected.end - FIRST_SECONDS) < 0.01
          ? 'first'
          : 'custom';

  return (
    <View style={styles.panel}>
      {texts.length > 1 && (
        <View style={styles.row}>
          {texts.map((t, i) => (
            <Chip key={t.id} label={`Text ${i + 1}`} selected={t.id === selectedId} onPress={() => onSelect(t.id)} />
          ))}
        </View>
      )}

      {selected ? (
        <>
          <TextField value={selected.text} onChangeText={(text) => patch({ text })} multiline placeholder="Your text" />
          <ThemedText type="small" themeColor="textSecondary">
            Drag the text on the video to move it. It stays clear of TikTok’s buttons.
          </ThemedText>

          {suggestions.length > 0 && (
            <>
              <ThemedText type="smallBold">Ideas</ThemedText>
              <View style={styles.row}>
                {suggestions.map((s) => {
                  const text = s.emoji ? `${s.text} ${s.emoji}` : s.text;
                  return (
                    <Chip key={text} label={text} selected={selected.text === text} onPress={() => patch({ text })} />
                  );
                })}
              </View>
            </>
          )}

          <ThemedText type="smallBold">Font</ThemedText>
          <View style={styles.row}>
            {TEXT_FONTS.map((key) => (
              <Chip
                key={key}
                label={FONTS[key].label}
                selected={selected.font === key}
                textStyle={{ fontFamily: fontFamily(key) }}
                onPress={() => patch({ font: key })}
              />
            ))}
          </View>

          <ThemedText type="smallBold">Color</ThemedText>
          <View style={styles.row}>
            {TEXT_COLORS.map((color) => (
              <Pressable
                key={color}
                accessibilityLabel={`Color ${color}`}
                onPress={() => patch({ color })}
                style={[
                  styles.swatch,
                  {
                    backgroundColor: color,
                    borderColor: selected.color === color ? theme.accent : theme.border,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.row}>
            <Chip label="Plain" selected={!selected.background} onPress={() => patch({ background: false })} />
            <Chip label="Box" selected={selected.background} onPress={() => patch({ background: true })} />
          </View>

          <ThemedText type="smallBold">Size</ThemedText>
          <View style={styles.row}>
            {TEXT_SIZES.map((s) => (
              <Chip
                key={s.label}
                label={s.label}
                selected={Math.abs(selected.size - s.value) < 0.001}
                onPress={() => patch({ size: s.value })}
              />
            ))}
          </View>

          <ThemedText type="smallBold">Show</ThemedText>
          <View style={styles.row}>
            <Chip label="Whole video" selected={timing === 'all'} onPress={() => patch({ start: 0, end: duration })} />
            <Chip
              label={`First ${FIRST_SECONDS}s`}
              selected={timing === 'first'}
              onPress={() => patch({ start: 0, end: Math.min(FIRST_SECONDS, duration) })}
            />
            <Chip
              label="From here on"
              selected={timing === 'custom'}
              onPress={() =>
                patch({
                  start: Math.min(time, Math.max(0, duration - 0.5)),
                  end: duration,
                })
              }
            />
          </View>

          <View style={styles.row}>
            <Button title="Delete text" variant="danger" onPress={() => onDelete(selected.id)} style={styles.flex} />
            <Button title="Add another" variant="secondary" onPress={onAdd} style={styles.flex} />
          </View>
        </>
      ) : (
        <Button title="Add text" onPress={onAdd} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 3 },
  flex: { flex: 1 },
});
