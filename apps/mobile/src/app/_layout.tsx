import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { FONT_SOURCES } from '@/constants/fonts';
import { AuthProvider, useAuth } from '@/lib/auth';
import { refreshCredits } from '@/lib/billing';
import { registerForPushNotifications, useNotificationTaps } from '@/lib/notifications';
import { hasSeenTutorial } from '@/lib/tutorial';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading } = useAuth();
  // Caption and text fonts; a failed load falls back to system fonts.
  const [fontsLoaded, fontError] = useFonts(FONT_SOURCES);
  const ready = !loading && (fontsLoaded || !!fontError);
  useNotificationTaps();

  // Keep this device's push token current; only prompts when a batch starts.
  const userId = session?.user.id;
  useEffect(() => {
    if (userId) void registerForPushNotifications({ prompt: false });
  }, [userId]);

  // Credits for the signed-in user, and the tutorial on first launch.
  useEffect(() => {
    if (!userId || !ready) return;
    void refreshCredits();
    hasSeenTutorial().then((seen) => {
      if (!seen) router.push('/tutorial');
    });
  }, [userId, ready]);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="cut/[id]"
          options={{
            headerShown: true,
            title: 'Edit',
            headerBackTitle: 'Back',
          }}
        />
        <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings', headerBackTitle: 'Profile' }} />
        <Stack.Screen name="plans" options={{ headerShown: true, title: 'Plans & credits', headerBackTitle: 'Back' }} />
        <Stack.Screen name="tutorial" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
