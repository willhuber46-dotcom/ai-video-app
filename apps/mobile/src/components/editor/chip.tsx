import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Chip({
  label,
  selected,
  onPress,
  textStyle,
  children,
}: {
  label?: string;
  selected?: boolean;
  onPress: () => void;
  textStyle?: StyleProp<TextStyle>;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: selected ? theme.accent : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      {children ?? (
        <ThemedText type="small" style={textStyle}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
