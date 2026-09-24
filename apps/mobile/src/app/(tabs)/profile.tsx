import { Button } from '@/components/button';
import { ComingSoon } from '@/components/coming-soon';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export default function ProfileScreen() {
  const { session } = useAuth();
  return (
    <ComingSoon
      title="Profile"
      body={`Signed in as ${session?.user.email ?? 'unknown'}.\n\nStats, your plan, credits and settings are coming soon.`}>
      <Button title="Sign out" variant="secondary" onPress={() => supabase.auth.signOut()} />
    </ComingSoon>
  );
}
