import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function TextField({ style, ...rest }: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.textSecondary}
      style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
  },
});
