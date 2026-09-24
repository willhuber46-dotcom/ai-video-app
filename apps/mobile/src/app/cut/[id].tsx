import {
  captionsFromTranscript,
  EMPTY_OVERLAYS,
  newId,
  textFromSuggestion,
  zoomAt,
  ZOOM_STRENGTHS,
  type AiSuggestions,
  type OverlayDoc,
  type TextOverlay,
  type Zoom,
} from '@app/shared';
import { useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { CaptionsPanel } from '@/components/editor/captions-panel';
import { OverlayLayer } from '@/components/editor/overlay-layer';
import { TextPanel } from '@/components/editor/text-panel';
import { Timeline } from '@/components/editor/timeline';
import { ZoomPanel } from '@/components/editor/zoom-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePlayerPlaying, usePlayerTime, useVideoDuration } from '@/hooks/use-player';
import { useTheme } from '@/hooks/use-theme';
import { fetchEditorData, saveOverlays, type EditorData } from '@/lib/overlays';
import { ensurePhotosPermission, saveCutToCameraRoll } from '@/lib/save';
import { fetchVideo, formatDuration, signedCutUrl, type VideoSummary } from '@/lib/videos';

type Tool = 'captions' | 'text' | 'zoom';

const SIDE = Spacing.four;
const AUTOSAVE_MS = 800;
const NEW_ZOOM_SECONDS = 1.5;

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const window = useWindowDimensions();

  const [video, setVideo] = useState<VideoSummary | null>(null);
  const [data, setData] = useState<EditorData | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<OverlayDoc>(EMPTY_OVERLAYS);
  const [tool, setTool] = useState<Tool | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'preparing' | 'downloading'>('idle');
  const loaded = useRef(false);

  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 1 / 30;
    p.play();
  });
  const [time, seekTo] = usePlayerTime(player);
  const playing = usePlayerPlaying(player);
  const playerDuration = useVideoDuration(player);
  const duration = playerDuration || Number(video?.output_duration_s ?? 0);

  useEffect(() => {
    (async () => {
      try {
        const [row, editor] = await Promise.all([fetchVideo(id), fetchEditorData(id)]);
        setVideo(row);
        setData(editor);
        setDoc(editor.overlays ?? EMPTY_OVERLAYS);
        loaded.current = true;
        if (!row.output_path) throw new Error('This video is not ready yet.');
        setUrl(await signedCutUrl(row.output_path));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load this video.');
      }
    })();
  }, [id]);

  // Autosave edits so they survive leaving the screen.
  useEffect(() => {
    if (!loaded.current || !data) return;
    const timer = setTimeout(() => {
      saveOverlays(id, doc).catch((err) => console.warn('Autosave failed', err));
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [doc, id, data]);

  const suggestions: AiSuggestions = data?.suggestions ?? {
    source: 'heuristic',
    texts: [],
    zooms: [],
  };

  // --- Tool buttons: add the AI suggestion the first time, then open the panel.

  function openCaptions() {
    if (!doc.captions) {
      if (!data?.transcript.length) {
        Alert.alert('No speech found', 'There are no spoken words in this video to caption.');
        return;
      }
      setDoc((d) => ({
        ...d,
        captions: captionsFromTranscript(data.transcript),
      }));
    }
    setTool('captions');
  }

  function addText() {
    const used = new Set(doc.texts.map((t) => t.text));
    const idea = suggestions.texts.map((s) => textFromSuggestion(s, duration)).find((t) => !used.has(t.text));
    const overlay: TextOverlay = idea ?? {
      ...textFromSuggestion({ text: 'Your text here', emoji: '' }, duration),
    };
    // Stack new text below any existing ones.
    overlay.y = Math.min(0.2 + doc.texts.length * 0.1, 0.6);
    setDoc((d) => ({ ...d, texts: [...d.texts, overlay] }));
    setSelectedTextId(overlay.id);
  }

  function openText() {
    if (doc.texts.length === 0) addText();
    else if (!selectedTextId) setSelectedTextId(doc.texts[0].id);
    setTool('text');
  }

  function openZoom() {
    if (doc.zooms.length === 0 && suggestions.zooms.length > 0) {
      const zooms = suggestions.zooms.map((z) => ({ ...z, id: newId() }));
      setDoc((d) => ({ ...d, zooms }));
      setSelectedZoomId(zooms[0].id);
    }
    setTool('zoom');
  }

  // --- Edits

  const changeText = (textId: string, patch: Partial<TextOverlay>) =>
    setDoc((d) => ({
      ...d,
      texts: d.texts.map((t) => (t.id === textId ? { ...t, ...patch } : t)),
    }));

  const deleteText = (textId: string) => {
    setDoc((d) => ({ ...d, texts: d.texts.filter((t) => t.id !== textId) }));
    setSelectedTextId(null);
  };

  /** Neighbors of a zoom, to keep zooms from overlapping. */
  function zoomBounds(zoomId: string, zooms: Zoom[]) {
    const others = zooms.filter((z) => z.id !== zoomId);
    const self = zooms.find((z) => z.id === zoomId)!;
    const prevEnd = Math.max(0, ...others.filter((z) => z.start < self.start).map((z) => z.end));
    const nextStart = Math.min(duration, ...others.filter((z) => z.start >= self.start).map((z) => z.start));
    return { prevEnd, nextStart };
  }

  const changeZoom = (zoomId: string, patch: Partial<Zoom>) =>
    setDoc((d) => {
      const { nextStart } = zoomBounds(zoomId, d.zooms);
      return {
        ...d,
        zooms: d.zooms.map((z) => {
          if (z.id !== zoomId) return z;
          const next = { ...z, ...patch };
          return { ...next, end: Math.min(next.end, nextStart) };
        }),
      };
    });

  const moveZoom = (zoomId: string, start: number) =>
    setDoc((d) => {
      const { prevEnd, nextStart } = zoomBounds(zoomId, d.zooms);
      return {
        ...d,
        zooms: d.zooms.map((z) => {
          if (z.id !== zoomId) return z;
          const length = z.end - z.start;
          const clamped = Math.min(Math.max(start, prevEnd), nextStart - length);
          return clamped < prevEnd ? z : { ...z, start: clamped, end: clamped + length };
        }),
      };
    });

  function addZoom() {
    const t = player.currentTime;
    if (doc.zooms.some((z) => t >= z.start && t < z.end)) {
      Alert.alert('Already zoomed here', 'Move the playhead to a spot without a zoom, or edit the existing one.');
      return;
    }
    const nextStart = Math.min(duration, ...doc.zooms.filter((z) => z.start > t).map((z) => z.start));
    const end = Math.min(t + NEW_ZOOM_SECONDS, nextStart);
    if (end - t < 0.6) {
      Alert.alert('Not enough room', 'There’s another zoom right after this spot.');
      return;
    }
    const zoom: Zoom = {
      id: newId(),
      start: t,
      end,
      scale: ZOOM_STRENGTHS[1].value,
      x: 0.5,
      y: 0.45,
    };
    setDoc((d) => ({
      ...d,
      zooms: [...d.zooms, zoom].sort((a, b) => a.start - b.start),
    }));
    setSelectedZoomId(zoom.id);
  }

  function tapVideo(x: number, y: number) {
    if (tool === 'zoom' && selectedZoomId) {
      changeZoom(selectedZoomId, {
        x: Math.min(Math.max(x, 0.05), 0.95),
        y: Math.min(Math.max(y, 0.05), 0.95),
      });
      return;
    }
    if (playing) player.pause();
    else player.play();
  }

  const seek = (t: number) => seekTo(Math.max(0, Math.min(t, duration)));

  // --- Save

  async function saveToCameraRoll() {
    if (!video?.output_path) return;
    try {
      if (!(await ensurePhotosPermission())) {
        Alert.alert('Allow access to Photos', 'We need permission to save videos to your camera roll.');
        return;
      }
      await saveCutToCameraRoll({ id, outputPath: video.output_path, overlays: doc }, setSaveState);
      Alert.alert('Saved', 'Your video is in your camera roll, ready to post.');
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaveState('idle');
    }
  }


  if (error) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText themeColor="textSecondary">{error}</ThemedText>
      </ThemedView>
    );
  }

  // Fit the frame to the screen width, but leave room for the tools below it.
  const aspect = (data?.width ?? 9) / (data?.height ?? 16);
  const frameWidth = Math.min(window.width - SIDE * 2, window.height * 0.5 * aspect);
  const frameHeight = frameWidth / aspect;
  const zoom = zoomAt(doc.zooms, time);
  const saving = saveState !== 'idle';

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View
            style={[
              styles.frame,
              {
                width: frameWidth,
                height: frameHeight,
                backgroundColor: theme.backgroundElement,
              },
            ]}>
            {url && data ? (
              <>
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      transformOrigin: 'top left',
                      transform: [
                        { translateX: -zoom.left * frameWidth * zoom.scale },
                        { translateY: -zoom.top * frameHeight * zoom.scale },
                        { scale: zoom.scale },
                      ],
                    },
                  ]}>
                  <VideoView player={player} style={styles.flex} contentFit="cover" nativeControls={false} />
                </View>
                <OverlayLayer
                  doc={doc}
                  time={time}
                  width={frameWidth}
                  height={frameHeight}
                  editing={tool !== null}
                  selectedTextId={tool === 'text' ? selectedTextId : null}
                  onSelectText={(textId) => {
                    setSelectedTextId(textId);
                    setTool('text');
                  }}
                  onChangeText={changeText}
                  onChangeCaptionsY={(y) => setDoc((d) => (d.captions ? { ...d, captions: { ...d.captions, y } } : d))}
                  onTap={tapVideo}
                />
                {!playing && (
                  <View pointerEvents="none" style={styles.playBadge}>
                    <ThemedText style={styles.playIcon}>▶</ThemedText>
                  </View>
                )}
              </>
            ) : (
              <ActivityIndicator style={styles.flex} />
            )}
          </View>

          <View style={styles.timeRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {formatDuration(time)} / {formatDuration(duration)}
            </ThemedText>
            {video?.source_duration_s != null && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatDuration(video.source_duration_s)} cut to {formatDuration(video.output_duration_s)}
              </ThemedText>
            )}
          </View>
          <Timeline
            duration={duration}
            time={time}
            zooms={doc.zooms}
            selectedZoomId={tool === 'zoom' ? selectedZoomId : null}
            onSeek={seek}
            onSelectZoom={(zoomId) => {
              setSelectedZoomId(zoomId);
              setTool('zoom');
            }}
            onMoveZoom={moveZoom}
          />

          <View style={styles.tools}>
            <ToolButton label="Auto Captions" active={tool === 'captions'} on={!!doc.captions} onPress={openCaptions} />
            <ToolButton label="Suggested Text" active={tool === 'text'} on={doc.texts.length > 0} onPress={openText} />
            <ToolButton label="Auto Zoom" active={tool === 'zoom'} on={doc.zooms.length > 0} onPress={openZoom} />
          </View>

          {tool === 'captions' && doc.captions && (
            <CaptionsPanel
              captions={doc.captions}
              time={time}
              onChange={(captions) => setDoc((d) => ({ ...d, captions }))}
              onRemove={() => {
                setDoc((d) => ({ ...d, captions: null }));
                setTool(null);
              }}
              onSeek={seek}
            />
          )}
          {tool === 'text' && (
            <TextPanel
              texts={doc.texts}
              selectedId={selectedTextId}
              suggestions={suggestions.texts}
              duration={duration}
              time={time}
              onSelect={setSelectedTextId}
              onChange={changeText}
              onAdd={addText}
              onDelete={deleteText}
            />
          )}
          {tool === 'zoom' && (
            <ZoomPanel
              zooms={doc.zooms}
              selectedId={selectedZoomId}
              duration={duration}
              onChange={changeZoom}
              onAdd={addZoom}
              onDelete={(zoomId) => {
                setDoc((d) => ({
                  ...d,
                  zooms: d.zooms.filter((z) => z.id !== zoomId),
                }));
                setSelectedZoomId(null);
              }}
              onRemoveAll={() => {
                setDoc((d) => ({ ...d, zooms: [] }));
                setSelectedZoomId(null);
              }}
            />
          )}
          {tool && <Button title="Done editing" variant="secondary" onPress={() => setTool(null)} />}

          <Button
            title={
              saveState === 'preparing'
                ? 'Adding your edits…'
                : saveState === 'downloading'
                  ? 'Saving…'
                  : 'Save to camera roll'
            }
            onPress={saveToCameraRoll}
            loading={saving}
            disabled={!url || saving}
          />
          {saveState === 'preparing' && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              We’re adding your captions, text and zooms. This usually takes under a minute.
            </ThemedText>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ToolButton({
  label,
  active,
  on,
  onPress,
}: {
  label: string;
  active: boolean;
  on: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: active ? theme.accent : theme.backgroundElement,
          opacity: pressed ? 0.8 : 1,
        },
      ]}>
      <ThemedText type="smallBold" style={active && { color: theme.onAccent }}>
        {label}
      </ThemedText>
      <ThemedText
        type="small"
        style={{
          color: active ? theme.onAccent : on ? theme.success : theme.textSecondary,
        }}>
        {on ? 'On' : 'Add'}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  centerText: { textAlign: 'center' },
  content: { padding: SIDE, gap: Spacing.three },
  frame: { alignSelf: 'center', borderRadius: 16, overflow: 'hidden' },
  playBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: '45%',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { color: '#fff', fontSize: 26, lineHeight: 30 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tools: { flexDirection: 'row', gap: Spacing.two },
  tool: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
});
