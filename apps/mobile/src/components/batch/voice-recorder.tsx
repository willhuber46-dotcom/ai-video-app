import { MAX_INPUT_SECONDS } from '@app/shared';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDuration, type PickedVideo } from '@/lib/videos';

/** Records the Voiceover voice track in the app. */
export function VoiceRecorder({ onDone, onCancel }: { onDone: (voice: PickedVideo) => void; onCancel: () => void }) {
  const theme = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);
  const seconds = state.durationMillis / 1000;

  async function start() {
    setStarting(true);
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        Alert.alert('Allow the microphone', 'We need microphone access to record your voiceover.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    if (!recorder.uri) return;
    onDone({ uri: recorder.uri, duration: seconds, mimeType: 'audio/mp4', fileName: 'voiceover.m4a' });
  }

  // Voice tracks are capped like any input.
  const overLimit = state.isRecording && seconds >= MAX_INPUT_SECONDS;
  useEffect(() => {
    if (overLimit) void stop();
    // stop() only reads the recorder; re-running on its identity isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overLimit]);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <ThemedView style={styles.container}>
        <View style={styles.text}>
          <ThemedText type="subtitle">Record your voiceover</ThemedText>
          <ThemedText themeColor="textSecondary">
            Talk about your product. We’ll cut the pauses and match your clips to what you say.
          </ThemedText>
        </View>

        <ThemedText type="title" style={styles.timer}>
          {formatDuration(seconds)}
        </ThemedText>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={state.isRecording ? 'Stop recording' : 'Start recording'}
          disabled={starting}
          onPress={state.isRecording ? stop : start}
          style={[styles.record, { borderColor: theme.accent }]}>
          <View style={[state.isRecording ? styles.stopIcon : styles.recordIcon, { backgroundColor: theme.accent }]} />
        </Pressable>

        <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={state.isRecording} />
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.four, gap: Spacing.five, justifyContent: 'center' },
  text: { gap: Spacing.two },
  timer: { textAlign: 'center', fontVariant: ['tabular-nums'] },
  record: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: { width: 64, height: 64, borderRadius: 32 },
  stopIcon: { width: 32, height: 32, borderRadius: 6 },
});
