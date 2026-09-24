import { StyleSheet, Text, View } from 'react-native';

import { TEXT_LAYOUT } from '@app/shared';

/**
 * One word of caption text. React Native has no text stroke, so the outline
 * the worker draws is approximated with dark copies offset in 8 directions.
 */
export function StyledWord({
  text,
  fontFamily,
  fontSize,
  color,
  strokeWidth = 0,
  background,
}: {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  /** Outline width as a fraction of font size. */
  strokeWidth?: number;
  /** Rounded box behind the word, as drawn for "highlight" captions. */
  background?: string | null;
}) {
  const lineHeight = fontSize * TEXT_LAYOUT.lineHeight;
  const base = { fontFamily, fontSize, lineHeight };
  const r = (fontSize * strokeWidth) / 2;
  const d = r * 0.7;
  const offsets =
    r > 0
      ? [
          [-r, 0],
          [r, 0],
          [0, -r],
          [0, r],
          [-d, -d],
          [d, -d],
          [-d, d],
          [d, d],
        ]
      : [];

  return (
    <View>
      {background && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: background,
              left: -fontSize * TEXT_LAYOUT.activePadX,
              right: -fontSize * TEXT_LAYOUT.activePadX,
              top: fontSize * TEXT_LAYOUT.activePadY,
              bottom: fontSize * TEXT_LAYOUT.activePadY,
              borderRadius: fontSize * TEXT_LAYOUT.activeRadius,
            },
          ]}
        />
      )}
      {offsets.map(([dx, dy], i) => (
        <Text key={i} style={[base, styles.stroke, { left: dx, top: dy }]}>
          {text}
        </Text>
      ))}
      <Text style={[base, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stroke: { position: 'absolute', color: 'rgba(0,0,0,0.9)' },
});
