import { Link } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

/** Shared email + password form for sign in and sign up. */
export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const isSignUp = mode === 'sign-up';
  const theme = useTheme();

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() || null } },
        });
        if (error) throw error;
        // With email confirmation on, there is no session until the link is tapped.
        if (!data.session) setMessage({ text: 'Check your email to confirm your account, then sign in.', error: false });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Something went wrong', error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
          <View style={styles.header}>
            <ThemedText type="subtitle">[App Name]</ThemedText>
            <ThemedText themeColor="textSecondary">Film, upload, post. We do the editing.</ThemedText>
          </View>

          <View style={styles.form}>
            {isSignUp && (
              <TextField placeholder="Name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
            )}
            <TextField
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextField
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
            />
            {message && (
              <ThemedText type="small" themeColor={message.error ? undefined : 'textSecondary'} style={message.error && { color: theme.danger }}>
                {message.text}
              </ThemedText>
            )}
            <Button
              title={isSignUp ? 'Create account' : 'Sign in'}
              loading={busy}
              disabled={!email || password.length < 6}
              onPress={submit}
            />
          </View>

          <Link href={isSignUp ? '/sign-in' : '/sign-up'} replace style={styles.switch}>
            <ThemedText type="linkPrimary">
              {isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </ThemedText>
          </Link>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.five },
  header: { gap: Spacing.two },
  form: { gap: Spacing.three },
  switch: { alignSelf: 'center' },
});
