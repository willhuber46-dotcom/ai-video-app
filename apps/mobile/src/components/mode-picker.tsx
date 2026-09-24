import { MODES, type EditMode } from '@app/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Every mode with its in-app description; modes from later phases show as "Coming soon". */
export function ModePicker({ value, onChange }: { value: EditMode; onChange: (mode: EditMode) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.list}>
      {MODES.map((mode) => {
        const selected = mode.key === value;
        return (
          <Pressable
            key={mode.key}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !mode.available }}
            disabled={!mode.available}
            onPress={() => onChange(mode.key)}
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: selected ? theme.accent : 'transparent',
                opacity: mode.available ? 1 : 0.5,
              },
            ]}>
            <View style={styles.header}>
              <ThemedText type="smallBold">{mode.name}</ThemedText>
              {!mode.available && (
                <ThemedText type="small" themeColor="textSecondary">
                  Coming soon
                </ThemedText>
              )}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {mode.description}
            </ThemedText>
            {mode.note && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
                {mode.note}
              </ThemedText>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  card: {
    borderRadius: 14,
    borderWidth: 2,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { fontStyle: 'italic' },
});
