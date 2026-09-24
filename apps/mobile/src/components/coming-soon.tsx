import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';

/** Placeholder for tabs that land in a later build phase. */
export function ComingSoon({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.container}>
        <View style={styles.text}>
          <ThemedText type="subtitle">{title}</ThemedText>
          <ThemedText themeColor="textSecondary">{body}</ThemedText>
        </View>
        {children}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, justifyContent: 'space-between' },
  text: { gap: Spacing.two },
});
