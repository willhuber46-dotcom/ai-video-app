import { Button } from '@/components/button';
import { ComingSoon } from '@/components/coming-soon';
import { useAuth } from '@/lib/auth';
import { unregisterPushNotifications } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { clearPendingUploads } from '@/lib/upload-queue';

async function signOut() {
  // Stop "batch ready" pushes to this phone for this account, then sign out.
  await unregisterPushNotifications().catch(() => {});
  await clearPendingUploads();
  await supabase.auth.signOut();
}

export default function ProfileScreen() {
  const { session } = useAuth();
  return (
    <ComingSoon
      title="Profile"
      body={`Signed in as ${session?.user.email ?? 'unknown'}.\n\nStats, your plan, credits and settings are coming soon.`}>
      <Button title="Sign out" variant="secondary" onPress={signOut} />
    </ComingSoon>
  );
}
