import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useTheme } from '@/hooks/use-theme';

// Open on Batch; Create sits first in the bar but ships in Phase 6.
export const unstable_settings = { initialRouteName: 'index' };

export default function TabLayout() {
  const theme = useTheme();

  return (
    <NativeTabs
      backgroundColor={theme.background}
      indicatorColor={theme.backgroundElement}
      labelStyle={{ selected: { color: theme.text } }}>
      <NativeTabs.Trigger name="create">
        <NativeTabs.Trigger.Label>Create</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'video', selected: 'video.fill' }} md="videocam" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Batch</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} md="video_library" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="cuts">
        <NativeTabs.Trigger.Label>Cuts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="scissors" md="content_cut" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
