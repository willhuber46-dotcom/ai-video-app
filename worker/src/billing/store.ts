import type { SupabaseClient } from '@supabase/supabase-js';

import type { BillingStore, Pack, Plan } from './handlers';

/** BillingStore over Supabase, using the service role and the SQL grant functions. */
export class SupabaseBillingStore implements BillingStore {
  constructor(private db: SupabaseClient) {}

  async plans(): Promise<Plan[]> {
    const { data, error } = await this.db.from('plans').select('key, stripe_price_id, monthly_credits');
    if (error) throw error;
    return data as Plan[];
  }

  async packs(): Promise<Pack[]> {
    const { data, error } = await this.db.from('credit_packs').select('key, stripe_price_id, credits');
    if (error) throw error;
    return data as Pack[];
  }

  async userForCustomer(customerId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  }

  async customerForUser(userId: string): Promise<string | null> {
    const { data, error } = await this.db.from('profiles').select('stripe_customer_id').eq('id', userId).single();
    if (error) throw error;
    return (data.stripe_customer_id as string | null) ?? null;
  }

  async saveCustomer(userId: string, customerId: string): Promise<void> {
    const { error } = await this.db.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
    if (error) throw error;
  }

  async grantPlan(
    userId: string,
    plan: string,
    periodEnd: Date,
    ref: string,
    subscriptionId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db.rpc('grant_plan', {
      p_user: userId,
      p_plan: plan,
      p_period_end: periodEnd.toISOString(),
      p_ref: ref,
      p_subscription: subscriptionId,
    });
    if (error) throw error;
    return Boolean(data);
  }

  async grantPack(userId: string, credits: number, ref: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('grant_pack', { p_user: userId, p_credits: credits, p_ref: ref });
    if (error) throw error;
    return Boolean(data);
  }

  async endSubscription(userId: string): Promise<void> {
    const { error } = await this.db.rpc('end_subscription', { p_user: userId });
    if (error) throw error;
  }
}
