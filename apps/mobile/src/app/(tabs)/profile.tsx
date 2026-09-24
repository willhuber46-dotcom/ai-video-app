import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCredits } from '@/lib/billing';
import { cutsThisMonth, fetchProfile, type Profile } from '@/lib/profile';

function Stat({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [styles.stat, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 }]}>
      <ThemedText type="subtitle">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
        {onPress ? ' ›' : ''}
      </ThemedText>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  const { session } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [monthCount, setMonthCount] = useState<number | null>(null);
  const credits = useCredits();
  const userId = session?.user.id;

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      fetchProfile(userId)
        .then(setProfile)
        .catch((err) => console.warn('Could not load profile', err));
      cutsThisMonth()
        .then(setMonthCount)
        .catch(() => {});
    }, [userId]),
  );

  const name = profile?.display_name || session?.user.email?.split('@')[0] || '';

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Profile</ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={10}
            onPress={() => router.push('/settings')}>
            <SymbolView name={{ ios: 'gearshape', android: 'settings' }} size={26} tintColor={theme.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.identity}>
            <ThemedText type="subtitle" numberOfLines={1}>
              {name}
            </ThemedText>
            <ThemedText themeColor="textSecondary">{session?.user.email}</ThemedText>
          </View>

          <View style={styles.stats}>
            <Stat
              label="Cuts made"
              value={profile ? String(profile.cuts_made) : '–'}
              onPress={() => router.navigate('/cuts')}
            />
            <Stat label="Plan" value={credits?.plan_label ?? '–'} onPress={() => router.push('/plans')} />
          </View>
          <View style={styles.stats}>
            <Stat label="Cuts this month" value={monthCount == null ? '–' : String(monthCount)} />
            <Stat
              label="Credits left"
              value={credits ? String(credits.available) : '–'}
              onPress={() => router.push('/plans')}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            One credit = one finished video. Credits reset each month; failed videos don’t use one.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.five, gap: Spacing.three },
  identity: { gap: Spacing.one, marginBottom: Spacing.two },
  stats: { flexDirection: 'row', gap: Spacing.three },
  stat: { flex: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
});
