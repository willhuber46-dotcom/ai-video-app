import { PACING_OPTIONS, usesPacing, type EditMode, type Pacing } from '@app/shared';
import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { ModePicker } from '@/components/mode-picker';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { formatDuration } from '@/lib/videos';

export type RecordedChoice = {
  mode: EditMode;
  pacing: Pacing;
  saveOriginal: boolean;
  /** 'now' edits it right away; 'batch' adds it to the batch to record more first. */
  action: 'now' | 'batch';
};

/** Shown the moment a recording stops: pick a mode, then edit now or add to the batch. */
export function RecordedSheet({
  seconds,
  initialMode,
  initialPacing,
  initialSaveOriginal,
  busy,
  onChoose,
  onDiscard,
}: {
  seconds: number;
  initialMode: EditMode;
  initialPacing: Pacing;
  initialSaveOriginal: boolean;
  busy: boolean;
  onChoose: (choice: RecordedChoice) => void;
  onDiscard: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [pacing, setPacing] = useState(initialPacing);
  const [saveOriginal, setSaveOriginal] = useState(initialSaveOriginal);
  // Voiceover needs a voice recording, which is added on the Batch tab.
  const canEditNow = mode !== 'voiceover';

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onDiscard}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <ThemedText type="subtitle">How should we edit it?</ThemedText>
            <ThemedText themeColor="textSecondary">{formatDuration(seconds)} recorded</ThemedText>
          </View>

          <ModePicker value={mode} onChange={setMode} />
          {usesPacing(mode) && (
            <View style={styles.section}>
              <ThemedText type="smallBold">Pacing</ThemedText>
              <SegmentedControl options={PACING_OPTIONS} value={pacing} onChange={setPacing} />
            </View>
          )}

          <View style={styles.switchRow}>
            <ThemedText style={styles.flex}>Also save the original to my camera roll</ThemedText>
            <Switch value={saveOriginal} onValueChange={setSaveOriginal} />
          </View>

          {canEditNow ? (
            <Button
              title="Edit now"
              loading={busy}
              onPress={() => onChoose({ mode, pacing, saveOriginal, action: 'now' })}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Voiceover needs your voice recording. Add this clip to the batch, then record or pick your voice there.
            </ThemedText>
          )}
          <Button
            title={canEditNow ? 'Add to batch and record more' : 'Add to batch'}
            variant={canEditNow ? 'secondary' : 'primary'}
            disabled={busy}
            onPress={() => onChoose({ mode, pacing, saveOriginal, action: 'batch' })}
          />
          <Button title="Discard" variant="danger" disabled={busy} onPress={onDiscard} />
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
});
