import { PACING_OPTIONS, type EditMode, type Pacing } from '@app/shared';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ModePicker } from '@/components/mode-picker';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/** Pick a mode (and pacing, for Talking Mode) for one video or the whole batch. */
export function ModeSheet({
  visible,
  title,
  initialMode,
  initialPacing,
  onDone,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initialMode: EditMode;
  initialPacing: Pacing;
  onDone: (mode: EditMode, pacing: Pacing) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [pacing, setPacing] = useState(initialPacing);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ModePicker value={mode} onChange={setMode} />
          {mode === 'talking' && (
            <View style={styles.section}>
              <ThemedText type="smallBold">Pacing</ThemedText>
              <SegmentedControl options={PACING_OPTIONS} value={pacing} onChange={setPacing} />
            </View>
          )}
          <Button title="Done" onPress={() => onDone(mode, pacing)} />
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { gap: Spacing.two },
});
