import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  BILLING_MODE,
  BILLING_WEBSITE,
  buy,
  fetchPacks,
  fetchPlans,
  formatPrice,
  manageSubscription,
  refreshCredits,
  useCredits,
  type PackOption,
  type PlanOption,
} from '@/lib/billing';

function Card({ children, highlighted }: { children: React.ReactNode; highlighted?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: highlighted ? theme.accent : 'transparent' },
      ]}>
      {children}
    </View>
  );
}

export default function PlansScreen() {
  const credits = useCredits();
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [packs, setPacks] = useState<PackOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const canBuy = BILLING_MODE === 'link';

  useFocusEffect(
    useCallback(() => {
      refreshCredits();
      Promise.all([fetchPlans(), fetchPacks()])
        .then(([p, k]) => {
          setPlans(p);
          setPacks(k);
        })
        .catch((err) => console.warn('Could not load plans', err));
    }, []),
  );

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      Alert.alert('Payments unavailable', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  }

  function choosePlan(plan: PlanOption) {
    // Switching between paid plans (or back to Free) happens in Stripe's portal,
    // so there's never more than one subscription.
    if (credits?.has_subscription) return run(plan.key, manageSubscription);
    return run(plan.key, async () => {
      if ((await buy('plan', plan.key)) === 'success') {
        Alert.alert('Welcome to ' + plan.label, 'Your new credits are ready.');
      }
    });
  }

  const resets = credits
    ? new Date(credits.period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          {credits && (
            <View style={styles.section}>
              <ThemedText type="subtitle">{credits.available} credits left</ThemedText>
              <ThemedText themeColor="textSecondary">
                {credits.plan_label} plan · {credits.plan_credits} of {credits.monthly_credits} monthly credits, renews{' '}
                {resets}
                {credits.pack_credits > 0 ? ` · ${credits.pack_credits} pack credits (never expire)` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                One credit = one finished video, up to 10 minutes of footage. Videos that fail don’t use a credit.
              </ThemedText>
            </View>
          )}

          {!plans ? (
            <ActivityIndicator />
          ) : (
            <>
              <ThemedText type="smallBold">Plans</ThemedText>
              {plans.map((plan) => {
                const current = credits?.plan === plan.key;
                return (
                  <Card key={plan.key} highlighted={current}>
                    <View style={styles.cardHeader}>
                      <ThemedText type="subtitle">{plan.label}</ThemedText>
                      <ThemedText type="smallBold">{formatPrice(plan.price_cents, true)}</ThemedText>
                    </View>
                    <ThemedText>{plan.monthly_credits} videos a month</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Batches of up to {plan.batch_limit} videos
                    </ThemedText>
                    {current ? (
                      <ThemedText type="smallBold" themeColor="textSecondary">
                        Your plan
                      </ThemedText>
                    ) : (
                      canBuy &&
                      (plan.purchasable || credits?.has_subscription) && (
                        <Button
                          title={credits?.has_subscription ? `Switch to ${plan.label}` : `Get ${plan.label}`}
                          loading={busy === plan.key}
                          disabled={busy !== null}
                          onPress={() => choosePlan(plan)}
                        />
                      )
                    )}
                  </Card>
                );
              })}

              {packs.length > 0 && (
                <>
                  <ThemedText type="smallBold">Need a few more?</ThemedText>
                  {packs.map((pack) => (
                    <Card key={pack.key}>
                      <View style={styles.cardHeader}>
                        <ThemedText type="subtitle">{pack.label}</ThemedText>
                        <ThemedText type="smallBold">{formatPrice(pack.price_cents)}</ThemedText>
                      </View>
                      <ThemedText type="small" themeColor="textSecondary">
                        One-time purchase. Pack credits never expire and are used after your monthly credits.
                      </ThemedText>
                      {canBuy && pack.purchasable && (
                        <Button
                          title="Buy"
                          variant="secondary"
                          loading={busy === pack.key}
                          disabled={busy !== null}
                          onPress={() =>
                            run(pack.key, async () => {
                              if ((await buy('pack', pack.key)) === 'success') {
                                Alert.alert('Credits added', `${pack.credits} credits are ready to use.`);
                              }
                            })
                          }
                        />
                      )}
                    </Card>
                  ))}
                </>
              )}

              {canBuy && credits?.has_subscription && (
                <Button
                  title="Manage subscription"
                  variant="secondary"
                  loading={busy === 'portal'}
                  disabled={busy !== null}
                  onPress={() => run('portal', manageSubscription)}
                />
              )}

              {canBuy ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                  Payments are handled securely by Stripe in your browser. Cancel anytime.
                </ThemedText>
              ) : (
                <View style={styles.section}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                    Plans and credit packs are available on our website.
                  </ThemedText>
                  {BILLING_WEBSITE !== '' && (
                    <Button
                      title="Visit website"
                      variant="secondary"
                      onPress={() => WebBrowser.openBrowserAsync(BILLING_WEBSITE)}
                    />
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { gap: Spacing.two },
  card: { borderRadius: 16, borderWidth: 2, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  center: { textAlign: 'center' },
});
