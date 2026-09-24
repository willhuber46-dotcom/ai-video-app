import { CAPTION_STYLES, type CaptionStyle, type Captions } from '@app/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/editor/chip';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function CaptionsPanel({
  captions,
  time,
  onChange,
  onRemove,
  onSeek,
}: {
  captions: Captions;
  time: number;
  onChange: (captions: Captions) => void;
  onRemove: () => void;
  onSeek: (t: number) => void;
}) {
  const theme = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = captions.words.find((w) => w.id === editingId);

  const updateWord = (text: string) =>
    onChange({
      ...captions,
      words: captions.words.map((w) => (w.id === editingId ? { ...w, text } : w)),
    });
  const deleteWord = () => {
    onChange({
      ...captions,
      words: captions.words.filter((w) => w.id !== editingId),
    });
    setEditingId(null);
  };

  return (
    <View style={styles.panel}>
      <ThemedText type="smallBold">Caption style</ThemedText>
      <View style={styles.row}>
        {(Object.keys(CAPTION_STYLES) as CaptionStyle[]).map((key) => (
          <Chip
            key={key}
            label={CAPTION_STYLES[key].label}
            selected={captions.style === key}
            onPress={() => onChange({ ...captions, style: key })}
          />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {CAPTION_STYLES[captions.style].description}. Drag captions on the video to move them.
      </ThemedText>

      <ThemedText type="smallBold">Words</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tap a word to fix it or delete it.
      </ThemedText>
      <View style={styles.words}>
        {captions.words.map((w) => {
          const current = time >= w.start && time < w.end;
          return (
            <Pressable
              key={w.id}
              onPress={() => {
                setEditingId(w.id);
                onSeek(w.start);
              }}
              style={[
                styles.word,
                {
                  backgroundColor:
                    w.id === editingId ? theme.accent : current ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="small" style={w.id === editingId && { color: theme.onAccent }}>
                {w.text}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {editing && (
        <View style={styles.editRow}>
          <TextField style={styles.flex} value={editing.text} onChangeText={updateWord} autoFocus autoCorrect={false} />
          <Button title="Delete" variant="danger" onPress={deleteWord} />
          <Button title="Done" variant="secondary" onPress={() => setEditingId(null)} />
        </View>
      )}

      <Button title="Remove captions" variant="danger" onPress={onRemove} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  word: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  editRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flex: { flex: 1 },
});
