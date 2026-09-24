import { BATCH_LIMIT, type EditMode, type Pacing } from '@app/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { RecordedSheet, type RecordedChoice } from '@/components/create/recorded-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getDrafts, newDraft, setDrafts, useDrafts } from '@/lib/drafts';
import { ensurePhotosPermission } from '@/lib/save';
import { draftProblem, startBatch } from '@/lib/start-batch';
import { formatDuration, type PickedVideo } from '@/lib/videos';

const LENGTHS = [
  { seconds: 60, label: '60s' },
  { seconds: 180, label: '3m' },
  { seconds: 600, label: '10m' },
] as const;

const SAVE_ORIGINAL_KEY = 'create.saveOriginal.v1';

type Recording = { uri: string; seconds: number };

function IconButton({
  label,
  ios,
  android,
  onPress,
  disabled,
}: {
  label: string;
  ios: SFSymbol;
  android: AndroidSymbol;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={10}
      style={[styles.iconButton, disabled && styles.dim]}>
      <SymbolView
        name={{ ios, android }}
        size={24}
        tintColor="#ffffff"
        fallback={<Text style={styles.iconFallback}>{label}</Text>}
      />
    </Pressable>
  );
}

export default function CreateScreen() {
  const theme = useTheme();
  const drafts = useDrafts();
  const camera = useRef<CameraView>(null);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();

  // The camera only runs while this tab is on screen.
  const [focused, setFocused] = useState(false);
  const [ready, setReady] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        // The camera unmounts; it reports ready again when it comes back.
        setFocused(false);
        setReady(false);
      };
    }, []),
  );

  const [facing, setFacing] = useState<CameraType>('back');
  const [torch, setTorch] = useState(false);
  const [maxSeconds, setMaxSeconds] = useState<number>(LENGTHS[0].seconds);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastChoice, setLastChoice] = useState<{ mode: EditMode; pacing: Pacing }>({
    mode: 'talking',
    pacing: 'natural',
  });
  const [saveOriginal, setSaveOriginal] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(SAVE_ORIGINAL_KEY)
      .then((v) => v !== null && setSaveOriginal(v === 'true'))
      .catch(() => {});
  }, []);

  // Recording timer.
  const isRecording = startedAt !== null;
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  async function record() {
    if (!camera.current || !ready) return;
    const began = Date.now();
    setStartedAt(began);
    setElapsed(0);
    try {
      // Resolves when stopped or when the chosen length is reached.
      const result = await camera.current.recordAsync({ maxDuration: maxSeconds });
      const seconds = Math.min(maxSeconds, (Date.now() - began) / 1000);
      if (result?.uri && seconds >= 1) setRecording({ uri: result.uri, seconds });
    } catch (err) {
      Alert.alert('Recording stopped', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setStartedAt(null);
      setTorch(false);
    }
  }

  function stop() {
    camera.current?.stopRecording();
  }

  async function choose(choice: RecordedChoice) {
    if (!recording) return;
    setBusy(true);
    setLastChoice({ mode: choice.mode, pacing: choice.pacing });
    setSaveOriginal(choice.saveOriginal);
    AsyncStorage.setItem(SAVE_ORIGINAL_KEY, String(choice.saveOriginal)).catch(() => {});

    if (choice.saveOriginal) {
      try {
        if (await ensurePhotosPermission()) await MediaLibrary.Asset.create(recording.uri);
      } catch (err) {
        console.warn('Could not save the original recording', err);
      }
    }

    const file: PickedVideo = {
      uri: recording.uri,
      duration: recording.seconds,
      mimeType: recording.uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
      fileName: null,
    };
    const draft = { ...newDraft([file]), mode: choice.mode, pacing: choice.pacing };
    VideoThumbnails.getThumbnailAsync(file.uri, { time: 500 })
      .then((t) => setDrafts((d) => d.map((x) => (x.key === draft.key ? { ...x, thumbnail: t.uri } : x))))
      .catch(() => {});

    try {
      if (choice.action === 'now') {
        const problem = draftProblem([draft]);
        if (problem) throw new Error(problem.message);
        await startBatch([draft]);
        setRecording(null);
        router.navigate('/');
        return;
      }
      if (getDrafts().length >= BATCH_LIMIT) {
        Alert.alert('Batch is full', `A batch holds ${BATCH_LIMIT} videos. Start editing it on the Batch tab first.`);
        return;
      }
      setDrafts((d) => [...d, draft]);
      setRecording(null);
    } catch (err) {
      // Don't lose the recording: park it in the batch instead.
      setDrafts((d) => [...d, draft]);
      setRecording(null);
      Alert.alert(
        "Couldn't start editing",
        `${err instanceof Error ? err.message : 'Please try again.'} It's waiting on the Batch tab.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    Alert.alert('Discard this recording?', 'It hasn’t been saved anywhere.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => setRecording(null) },
    ]);
  }

  if (!cameraPermission || !micPermission) return <ThemedView style={styles.flex} />;

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <ThemedView style={styles.flex}>
        <SafeAreaView style={styles.permission}>
          <ThemedText type="subtitle">Film in the app</ThemedText>
          <ThemedText themeColor="textSecondary">
            Allow the camera and microphone to record here. Your video goes straight into a batch, so you never have to
            find it in your camera roll.
          </ThemedText>
          <Button
            title="Allow camera and microphone"
            onPress={async () => {
              const cam = cameraPermission.granted ? cameraPermission : await requestCamera();
              const mic = micPermission.granted ? micPermission : await requestMic();
              if ((!cam.granted && !cam.canAskAgain) || (!mic.granted && !mic.canAskAgain)) {
                Alert.alert('Permission needed', 'Turn on camera and microphone access for [App Name] in Settings.');
              }
            }}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const remaining = Math.max(0, maxSeconds - elapsed);

  return (
    <View style={styles.flex}>
      {focused && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          mode="video"
          facing={facing}
          enableTorch={torch}
          videoQuality="1080p"
          onCameraReady={() => setReady(true)}
          onMountError={(e) => Alert.alert('Camera unavailable', e.message)}
        />
      )}

      <SafeAreaView style={styles.overlay} edges={['top']}>
        <View style={styles.topBar}>
          {drafts.length > 0 && !isRecording ? (
            <Pressable onPress={() => router.navigate('/')} style={styles.batchPill} accessibilityRole="button">
              <Text style={styles.pillText}>{drafts.length} in batch ›</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <View style={styles.topActions}>
            {facing === 'back' && (
              <IconButton
                label={torch ? 'Flash on' : 'Flash off'}
                ios={torch ? 'bolt.fill' : 'bolt.slash.fill'}
                android={torch ? 'flash_on' : 'flash_off'}
                onPress={() => setTorch((t) => !t)}
              />
            )}
            <IconButton
              label="Flip camera"
              ios="arrow.triangle.2.circlepath.camera"
              android="cameraswitch"
              // Flipping mid-recording would end the recording.
              disabled={isRecording}
              onPress={() => {
                setTorch(false);
                setFacing((f) => (f === 'back' ? 'front' : 'back'));
              }}
            />
          </View>
        </View>

        <View style={[styles.bottom, { paddingBottom: BottomTabInset + Spacing.four }]}>
          {isRecording ? (
            <Text style={styles.timer}>
              {formatDuration(elapsed)} · {formatDuration(remaining)} left
            </Text>
          ) : (
            <View style={styles.lengths}>
              {LENGTHS.map((l) => (
                <Pressable
                  key={l.seconds}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: maxSeconds === l.seconds }}
                  onPress={() => setMaxSeconds(l.seconds)}
                  style={[styles.length, maxSeconds === l.seconds && { backgroundColor: 'rgba(255,255,255,0.9)' }]}>
                  <Text style={[styles.lengthText, maxSeconds === l.seconds && styles.lengthTextOn]}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {isRecording && (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.min(100, (elapsed / maxSeconds) * 100)}%`, backgroundColor: theme.accent },
                ]}
              />
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
            disabled={!ready}
            onPress={isRecording ? stop : record}
            style={[styles.shutter, !ready && styles.dim]}>
            <View style={[isRecording ? styles.stopIcon : styles.recordIcon, { backgroundColor: theme.accent }]} />
          </Pressable>
        </View>
      </SafeAreaView>

      {recording && (
        <RecordedSheet
          seconds={recording.seconds}
          initialMode={lastChoice.mode}
          initialPacing={lastChoice.pacing}
          initialSaveOriginal={saveOriginal}
          busy={busy}
          onChoose={choose}
          onDiscard={discard}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  dim: { opacity: 0.4 },
  permission: { flex: 1, padding: Spacing.four, gap: Spacing.three, justifyContent: 'center' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  topActions: { flexDirection: 'row', gap: Spacing.three },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconFallback: { color: '#fff', fontSize: 10 },
  batchPill: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pillText: { color: '#fff', fontWeight: 600 },
  bottom: { alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  lengths: {
    flexDirection: 'row',
    gap: Spacing.two,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 999,
    padding: 4,
  },
  length: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: 999 },
  lengthText: { color: '#fff', fontWeight: 600 },
  lengthTextOn: { color: '#000' },
  timer: { color: '#fff', fontSize: 17, fontWeight: 700, fontVariant: ['tabular-nums'] },
  progressTrack: { alignSelf: 'stretch', height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: '100%', borderRadius: 2 },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: { width: 62, height: 62, borderRadius: 31 },
  stopIcon: { width: 30, height: 30, borderRadius: 6 },
});
