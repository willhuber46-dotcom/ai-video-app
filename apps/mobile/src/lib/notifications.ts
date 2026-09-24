import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const TOKEN_KEY = 'pushToken.v1';

// Show "your batch is ready" even when the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Registers this device for "batch finished" pushes. With `prompt: false` it
 * only refreshes the token if permission was already given.
 */
export async function registerForPushNotifications({ prompt }: { prompt: boolean }): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Edits ready',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted && prompt) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('Push notifications need an EAS project id. Run `npx eas-cli init` in apps/mobile.');
      return null;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw error;
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (err) {
    console.warn('Could not register for push notifications', err);
    return null;
  }
}

/** Stops pushes to this device for the signed-in user. Call before signing out. */
export async function unregisterPushNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Tapping a notification opens the right tab: Batch for "ready", Cuts for "expiring". */
export function useNotificationTaps() {
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data;
      if (data?.screen === 'cuts') router.navigate('/cuts');
      else if (data?.batchId) router.navigate('/');
    };
    // The app may have been launched by tapping the notification.
    Notifications.getLastNotificationResponseAsync().then(open);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
