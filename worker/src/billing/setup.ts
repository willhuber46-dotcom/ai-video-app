/**
 * Creates (or finds) the Stripe products and prices for every plan and credit
 * pack in the database, then saves their price ids. Safe to run again: prices
 * are matched by lookup key, and a changed amount gets a new price.
 *   npm run billing:setup -w worker
 */
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const stripe = new Stripe(required('STRIPE_SECRET_KEY'));
const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensurePrice(opts: {
  lookupKey: string;
  name: string;
  cents: number;
  recurring: boolean;
}): Promise<string> {
  const lookupKey = `${opts.lookupKey}_${opts.cents}`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (existing.data[0]) return existing.data[0].id;
  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: opts.cents,
    lookup_key: lookupKey,
    product_data: { name: opts.name },
    ...(opts.recurring ? { recurring: { interval: 'month' as const } } : {}),
  });
  return price.id;
}

const { data: plans, error: planError } = await db.from('plans').select('key, label, price_cents');
if (planError) throw planError;
for (const plan of plans) {
  if (plan.price_cents <= 0) continue;
  const id = await ensurePrice({
    lookupKey: `plan_${plan.key}`,
    name: `[App Name] ${plan.label}`,
    cents: plan.price_cents,
    recurring: true,
  });
  await db.from('plans').update({ stripe_price_id: id }).eq('key', plan.key);
  console.log(`Plan ${plan.key}: ${id}`);
}

const { data: packs, error: packError } = await db.from('credit_packs').select('key, label, price_cents');
if (packError) throw packError;
for (const pack of packs) {
  const id = await ensurePrice({
    lookupKey: `pack_${pack.key}`,
    name: `[App Name] ${pack.label}`,
    cents: pack.price_cents,
    recurring: false,
  });
  await db.from('credit_packs').update({ stripe_price_id: id }).eq('key', pack.key);
  console.log(`Pack ${pack.key}: ${id}`);
}
console.log('Done. Point a Stripe webhook at <BILLING_PUBLIC_URL>/stripe/webhook (see README).');
