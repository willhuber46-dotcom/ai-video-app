import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = Omit<PressableProps, 'children'> & {
  title: string;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
};

export function Button({ title, variant = 'primary', loading, disabled, style, ...rest }: Props) {
  const theme = useTheme();
  const background = variant === 'primary' ? theme.accent : theme.backgroundElement;
  const color = variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.danger : theme.text;
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      style={(state) => [
        styles.button,
        { backgroundColor: background, opacity: inactive ? 0.5 : state.pressed ? 0.8 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.title, { color }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: 600,
  },
});
