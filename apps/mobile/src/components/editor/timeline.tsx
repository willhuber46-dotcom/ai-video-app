import type { Zoom } from '@app/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

const HEIGHT = 44;

function ZoomMarker({
  zoom,
  pxPerSecond,
  duration,
  selected,
  color,
  onSelect,
  onMove,
}: {
  zoom: Zoom;
  pxPerSecond: number;
  duration: number;
  selected: boolean;
  color: string;
  onSelect: () => void;
  onMove: (start: number) => void;
}) {
  const dragStart = useSharedValue(zoom.start);
  const length = zoom.end - zoom.start;
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onStart(() => {
      dragStart.set(zoom.start);
      onSelect();
    })
    .onUpdate((e) => {
      const start = Math.min(Math.max(0, dragStart.get() + e.translationX / pxPerSecond), duration - length);
      onMove(Math.round(start * 20) / 20);
    });
  const tap = Gesture.Tap().runOnJS(true).onEnd(onSelect);

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        hitSlop={{ top: 8, bottom: 8 }}
        style={[
          styles.marker,
          {
            left: zoom.start * pxPerSecond,
            width: Math.max(8, (zoom.end - zoom.start) * pxPerSecond),
            backgroundColor: color,
            opacity: selected ? 1 : 0.6,
            borderWidth: selected ? 2 : 0,
          },
        ]}
      />
    </GestureDetector>
  );
}

/** Scrubber with zoom markers: tap to seek, drag a marker to move it. */
export function Timeline({
  duration,
  time,
  zooms,
  selectedZoomId,
  onSeek,
  onSelectZoom,
  onMoveZoom,
}: {
  duration: number;
  time: number;
  zooms: Zoom[];
  selectedZoomId: string | null;
  onSeek: (t: number) => void;
  onSelectZoom: (id: string) => void;
  onMoveZoom: (id: string, start: number) => void;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const pxPerSecond = duration > 0 ? width / duration : 0;

  return (
    <View
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => duration > 0 && width > 0 && onSeek((e.nativeEvent.locationX / width) * duration)}
      />
      {pxPerSecond > 0 &&
        zooms.map((z) => (
          <ZoomMarker
            key={z.id}
            zoom={z}
            pxPerSecond={pxPerSecond}
            duration={duration}
            selected={z.id === selectedZoomId}
            color={theme.accent}
            onSelect={() => onSelectZoom(z.id)}
            onMove={(start) => onMoveZoom(z.id, start)}
          />
        ))}
      {pxPerSecond > 0 && (
        <View
          pointerEvents="none"
          style={[styles.playhead, { left: time * pxPerSecond, backgroundColor: theme.text }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  marker: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    borderRadius: 6,
    borderColor: '#ffffff',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
});
