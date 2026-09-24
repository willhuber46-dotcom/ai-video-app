import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SelectOption = { value: string; label: string; disabled?: boolean; note?: string };

/** A dropdown shown as a bottom sheet: pick one option from a list. */
export function SelectSheet({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly SelectOption[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ThemedView style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <View style={[styles.list, { backgroundColor: theme.backgroundElement }]}>
            {options.map((option, i) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: option.value === value, disabled: option.disabled }}
                disabled={option.disabled}
                onPress={() => onSelect(option.value)}
                style={({ pressed }) => [
                  styles.option,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
                  { opacity: option.disabled ? 0.45 : pressed ? 0.7 : 1 },
                ]}>
                <View style={styles.flex}>
                  <ThemedText>{option.label}</ThemedText>
                  {option.note && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {option.note}
                    </ThemedText>
                  )}
                </View>
                {option.value === value && <ThemedText style={{ color: theme.accent }}>✓</ThemedText>}
              </Pressable>
            ))}
          </View>
          <Button title="Close" variant="secondary" onPress={onClose} />
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  list: { borderRadius: 14, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, gap: Spacing.two },
});
