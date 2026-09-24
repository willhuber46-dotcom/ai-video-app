import { languageLabel, RECORD_LANGUAGES } from '@app/shared';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { SelectSheet } from '@/components/select-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCredits } from '@/lib/billing';
import { fetchProfile, updateProfile, type Profile } from '@/lib/profile';
import { clearAppStorage, deleteAccount, signOut } from '@/lib/session';
import { supabase } from '@/lib/supabase';

const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';
const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? '';
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL ?? '';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
      <View style={[styles.group, { backgroundColor: theme.backgroundElement }]}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
  disabled,
  first,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
  first?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.border },
        { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
      ]}>
      <ThemedText style={styles.flex}>{label}</ThemedText>
      {value != null && <ThemedText themeColor="textSecondary">{value}</ThemedText>}
      {onPress && !disabled && <ThemedText themeColor="textSecondary">›</ThemedText>}
    </Pressable>
  );
}

async function openLink(url: string, what: string) {
  if (!url) {
    Alert.alert(`${what} isn’t published yet`, 'Check back soon.');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}

export default function SettingsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [sheet, setSheet] = useState<'language' | null>(null);
  const credits = useCredits();
  const [busy, setBusy] = useState<'name' | 'email' | 'delete' | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchProfile(userId)
      .then((p) => {
        setProfile(p);
        setName(p.display_name ?? '');
      })
      .catch((err) => console.warn('Could not load profile', err));
  }, [userId]);

  async function saveName() {
    if (!userId || name.trim() === (profile?.display_name ?? '')) return;
    setBusy('name');
    try {
      await updateProfile(userId, { display_name: name.trim() || null });
      setProfile((p) => p && { ...p, display_name: name.trim() || null });
    } catch (err) {
      Alert.alert("Couldn't save your name", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function changeEmail() {
    const next = email.trim();
    if (!next || next === session?.user.email) return;
    setBusy('email');
    try {
      const { error } = await supabase.auth.updateUser({ email: next });
      if (error) throw error;
      Alert.alert('Check your inbox', `We sent a link to ${next}. Your email changes once you tap it.`);
    } catch (err) {
      Alert.alert("Couldn't change email", err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  async function chooseLanguage(code: string) {
    setSheet(null);
    if (!userId) return;
    const previous = profile?.record_language;
    setProfile((p) => p && { ...p, record_language: code });
    try {
      await updateProfile(userId, { record_language: code });
    } catch (err) {
      setProfile((p) => (p && previous ? { ...p, record_language: previous } : p));
      Alert.alert("Couldn't save", err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function clearStorage() {
    const result = await clearAppStorage();
    Alert.alert(
      result === 'cleared' ? 'Storage cleared' : 'Uploads in progress',
      result === 'cleared'
        ? 'Cached thumbnails and downloads were removed. Your cuts are safe on the server.'
        : 'Wait for your uploads to finish, then try again.',
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This deletes your account, all your cuts and uploads. It can’t be undone. Videos already saved to your camera roll stay there.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Are you sure?', 'Your account will be permanently deleted.', [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete forever',
                style: 'destructive',
                onPress: async () => {
                  setBusy('delete');
                  try {
                    await deleteAccount();
                  } catch (err) {
                    setBusy(null);
                    Alert.alert(
                      "Couldn't delete your account",
                      err instanceof Error ? err.message : 'Please try again.',
                    );
                  }
                },
              },
            ]),
        },
      ],
    );
  }

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Section title="Account">
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                Name
              </ThemedText>
              <TextField
                value={name}
                onChangeText={setName}
                onBlur={saveName}
                onSubmitEditing={saveName}
                returnKeyType="done"
                autoComplete="name"
                placeholder="Your name"
                editable={busy !== 'name'}
              />
            </View>
            <View style={styles.field}>
              <ThemedText type="small" themeColor="textSecondary">
                Email
              </ThemedText>
              <TextField
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
              />
              {email.trim() !== (session?.user.email ?? '') && (
                <Button title="Change email" variant="secondary" loading={busy === 'email'} onPress={changeEmail} />
              )}
            </View>
          </Section>

          <Section title="Subscription">
            <Row
              first
              label="Plan"
              value={credits ? `${credits.plan_label} ▾` : '–'}
              onPress={() => router.push('/plans')}
            />
          </Section>

          <Section title="Preferences">
            <Row
              first
              label="I record in"
              value={profile ? `${languageLabel(profile.record_language)} ▾` : '–'}
              onPress={() => setSheet('language')}
            />
          </Section>
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Used to transcribe your videos and write captions.
          </ThemedText>

          <Section title="Support">
            <Row
              first
              label="Help and contact"
              onPress={() =>
                SUPPORT_EMAIL
                  ? Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[App Name] help')}`)
                  : Alert.alert('Support', 'A support address hasn’t been set up yet.')
              }
            />
            <Row label="Refresh app data / clear storage" onPress={clearStorage} />
            <Row label="Replay tutorial" onPress={() => router.push('/tutorial')} />
          </Section>

          <Section title="Legal">
            <Row first label="Privacy policy" onPress={() => openLink(PRIVACY_URL, 'The privacy policy')} />
            <Row label="Terms of service" onPress={() => openLink(TERMS_URL, 'The terms of service')} />
          </Section>

          <Button title="Sign out" variant="secondary" onPress={() => signOut()} />
          <Button title="Delete account" variant="danger" loading={busy === 'delete'} onPress={confirmDelete} />
        </ScrollView>
      </SafeAreaView>

      <SelectSheet
        visible={sheet === 'language'}
        title="I record in"
        value={profile?.record_language ?? 'en'}
        options={RECORD_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
        onSelect={chooseLanguage}
        onClose={() => setSheet(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four },
  section: { gap: Spacing.two },
  sectionTitle: { paddingHorizontal: Spacing.two },
  group: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.three, minHeight: 52 },
  field: { gap: Spacing.one, padding: Spacing.three },
  hint: { marginTop: -Spacing.three, paddingHorizontal: Spacing.two },
});
