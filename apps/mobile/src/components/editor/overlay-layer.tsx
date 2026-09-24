import {
  CAPTION_MAX_WIDTH,
  CAPTION_STYLES,
  captionFrameAt,
  captionTokens,
  contrastColor,
  fitInSafeZone,
  groupCaptions,
  SAFE_ZONE,
  TEXT_LAYOUT,
  TEXT_MAX_WIDTH,
  type Captions,
  type OverlayDoc,
  type TextOverlay,
} from '@app/shared';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';

import { StyledWord } from '@/components/editor/styled-word';
import { fontFamily } from '@/constants/fonts';

type Size = { w: number; h: number };

/** A pan gesture that runs on the JS thread, so it can update React state. */
function dragGesture(opts: { enabled?: boolean; onStart: () => void; onMove: (dx: number, dy: number) => void }) {
  return Gesture.Pan()
    .enabled(opts.enabled ?? true)
    .runOnJS(true)
    .onStart(opts.onStart)
    .onUpdate((e) => opts.onMove(e.translationX, e.translationY));
}

/** Places a measured box at a normalized center, kept inside the safe zone. */
function placement(x: number, y: number, size: Size | null, W: number, H: number) {
  if (!size) return { left: x * W, top: y * H, opacity: 0 };
  const pos = fitInSafeZone(x, y, size.w / 2 / W, size.h / 2 / H);
  return {
    left: pos.x * W - size.w / 2,
    top: pos.y * H - size.h / 2,
    opacity: 1,
  };
}

function CaptionsView({
  captions,
  time,
  width: W,
  height: H,
  draggable,
  onMoveY,
}: {
  captions: Captions;
  time: number;
  width: number;
  height: number;
  draggable: boolean;
  onMoveY: (y: number) => void;
}) {
  const spec = CAPTION_STYLES[captions.style];
  const groups = useMemo(() => groupCaptions(captions.words, captions.style), [captions.words, captions.style]);
  const [size, setSize] = useState<Size | null>(null);
  const startY = useSharedValue(captions.y);
  const drag = dragGesture({
    enabled: draggable,
    onStart: () => {
      startY.set(captions.y);
    },
    onMove: (_dx, dy) => onMoveY(Math.min(1, Math.max(0, startY.get() + dy / H))),
  });

  const frame = captionFrameAt(groups, time);
  if (!frame) return null;
  const fontSize = spec.size * W;
  const tokens = captionTokens(frame, captions.style);

  return (
    <GestureDetector gesture={drag}>
      <View
        onLayout={(e: LayoutChangeEvent) =>
          setSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
        style={[
          styles.captions,
          { maxWidth: CAPTION_MAX_WIDTH * W, columnGap: fontSize * 0.28 },
          placement(0.5, captions.y, size, W, H),
        ]}>
        {tokens.map((token, i) => (
          <StyledWord
            key={`${i}-${token.text}`}
            text={token.text}
            fontFamily={fontFamily(spec.font)}
            fontSize={fontSize}
            color={token.active && spec.activeColor ? spec.activeColor : spec.color}
            strokeWidth={spec.strokeWidth}
            background={token.active ? spec.activeBackground : null}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function TextView({
  overlay,
  width: W,
  height: H,
  selected,
  onSelect,
  onMove,
}: {
  overlay: TextOverlay;
  width: number;
  height: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const [size, setSize] = useState<Size | null>(null);
  const start = useSharedValue({ x: overlay.x, y: overlay.y });
  const drag = dragGesture({
    onStart: () => {
      start.set({ x: overlay.x, y: overlay.y });
      onSelect();
    },
    onMove: (dx, dy) => {
      if (!size) return;
      // Snap the stored position to where it is drawn, so it never drifts into a UI zone.
      const pos = fitInSafeZone(start.get().x + dx / W, start.get().y + dy / H, size.w / 2 / W, size.h / 2 / H);
      onMove(pos.x, pos.y);
    },
  });

  const tap = Gesture.Tap().runOnJS(true).onEnd(onSelect);
  const fontSize = overlay.size * W;
  return (
    <GestureDetector gesture={Gesture.Exclusive(drag, tap)}>
      <View
        onLayout={(e) =>
          setSize({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
        style={[
          styles.text,
          overlay.background && {
            backgroundColor: overlay.color,
            borderRadius: fontSize * TEXT_LAYOUT.boxRadius,
            paddingHorizontal: fontSize * TEXT_LAYOUT.boxPadX,
            paddingVertical: fontSize * TEXT_LAYOUT.boxPadY,
          },
          selected && styles.selected,
          placement(overlay.x, overlay.y, size, W, H),
        ]}>
        <Text
          style={[
            styles.textInner,
            {
              maxWidth: TEXT_MAX_WIDTH * W,
              fontFamily: fontFamily(overlay.font),
              fontSize,
              lineHeight: fontSize * TEXT_LAYOUT.lineHeight,
              color: overlay.background ? contrastColor(overlay.color) : overlay.color,
            },
            !overlay.background && {
              textShadowRadius: fontSize * TEXT_LAYOUT.shadowBlur,
            },
          ]}>
          {overlay.text}
        </Text>
      </View>
    </GestureDetector>
  );
}

/** Faint shading over the areas TikTok's own buttons and caption cover. */
function SafeZoneGuides() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.guide, { top: 0, left: 0, right: 0, height: `${SAFE_ZONE.top * 100}%` }]} />
      <View
        style={[
          styles.guide,
          {
            bottom: 0,
            left: 0,
            right: 0,
            height: `${SAFE_ZONE.bottom * 100}%`,
          },
        ]}
      />
      <View
        style={[
          styles.guide,
          {
            top: `${SAFE_ZONE.top * 100}%`,
            bottom: `${SAFE_ZONE.bottom * 100}%`,
            right: 0,
            width: `${SAFE_ZONE.right * 100}%`,
          },
        ]}
      />
      <View
        style={[
          styles.guide,
          {
            top: `${SAFE_ZONE.top * 100}%`,
            bottom: `${SAFE_ZONE.bottom * 100}%`,
            left: 0,
            width: `${SAFE_ZONE.left * 100}%`,
          },
        ]}
      />
    </View>
  );
}

export function OverlayLayer({
  doc,
  time,
  width,
  height,
  editing,
  selectedTextId,
  onSelectText,
  onChangeText,
  onChangeCaptionsY,
  onTap,
}: {
  doc: OverlayDoc;
  time: number;
  width: number;
  height: number;
  /** Show safe-zone guides and allow dragging captions. */
  editing: boolean;
  selectedTextId: string | null;
  onSelectText: (id: string) => void;
  onChangeText: (id: string, patch: Partial<TextOverlay>) => void;
  onChangeCaptionsY: (y: number) => void;
  /** Tap on the video, in normalized coordinates. */
  onTap: (x: number, y: number) => void;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => onTap(e.nativeEvent.locationX / width, e.nativeEvent.locationY / height)}
      />
      {editing && <SafeZoneGuides />}
      {doc.texts
        .filter((t) => time >= t.start && time < t.end)
        .map((t) => (
          <TextView
            key={t.id}
            overlay={t}
            width={width}
            height={height}
            selected={editing && t.id === selectedTextId}
            onSelect={() => onSelectText(t.id)}
            onMove={(x, y) => onChangeText(t.id, { x, y })}
          />
        ))}
      {doc.captions && (
        <CaptionsView
          captions={doc.captions}
          time={time}
          width={width}
          height={height}
          draggable={editing}
          onMoveY={onChangeCaptionsY}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  captions: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  text: { position: 'absolute' },
  textInner: {
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 0 },
  },
  selected: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.9)',
  },
  guide: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.12)' },
});
