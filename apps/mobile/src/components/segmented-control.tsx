import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={[styles.segment, selected && { backgroundColor: theme.background }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'}>{option.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 12, padding: Spacing.one },
  segment: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: 9 },
});
