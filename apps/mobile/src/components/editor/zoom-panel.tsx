import { ZOOM_MIN_SECONDS, ZOOM_STRENGTHS, type Zoom } from '@app/shared';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/editor/chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const LENGTH_STEP = 0.5;

export function ZoomPanel({
  zooms,
  selectedId,
  duration,
  onChange,
  onAdd,
  onDelete,
  onRemoveAll,
}: {
  zooms: Zoom[];
  selectedId: string | null;
  duration: number;
  onChange: (id: string, patch: Partial<Zoom>) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRemoveAll: () => void;
}) {
  const selected = zooms.find((z) => z.id === selectedId) ?? null;
  const length = selected ? selected.end - selected.start : 0;

  return (
    <View style={styles.panel}>
      <ThemedText type="small" themeColor="textSecondary">
        {zooms.length === 0
          ? 'No zooms yet.'
          : `${zooms.length} zoom${zooms.length === 1 ? '' : 's'}. Tap a marker on the timeline to edit it, or drag it to move it.`}
      </ThemedText>

      {selected && (
        <>
          <ThemedText type="smallBold">Strength</ThemedText>
          <View style={styles.row}>
            {ZOOM_STRENGTHS.map((s) => (
              <Chip
                key={s.label}
                label={s.label}
                selected={Math.abs(selected.scale - s.value) < 0.001}
                onPress={() => onChange(selected.id, { scale: s.value })}
              />
            ))}
          </View>

          <ThemedText type="smallBold">Length: {length.toFixed(1)}s</ThemedText>
          <View style={styles.row}>
            <Chip
              label="Shorter"
              onPress={() =>
                onChange(selected.id, {
                  end: Math.max(selected.start + ZOOM_MIN_SECONDS, selected.end - LENGTH_STEP),
                })
              }
            />
            <Chip
              label="Longer"
              onPress={() =>
                onChange(selected.id, {
                  end: Math.min(duration, selected.end + LENGTH_STEP),
                })
              }
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Tap the video to aim the zoom at your product.
          </ThemedText>
          <Button title="Delete zoom" variant="danger" onPress={() => onDelete(selected.id)} />
        </>
      )}

      <Button title="Add zoom here" variant="secondary" onPress={onAdd} />
      {zooms.length > 0 && <Button title="Remove all zooms" variant="danger" onPress={onRemoveAll} />}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
});
