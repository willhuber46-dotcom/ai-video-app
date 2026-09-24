import { BATCH_LIMIT } from '@app/shared';
import * as WebBrowser from 'expo-web-browser';
import { useSyncExternalStore } from 'react';

import { supabase } from '@/lib/supabase';

/**
 * Plans, credits and checkout. Payments happen on Stripe's hosted pages in the
 * browser; the billing server applies them to the account via webhooks.
 */

const BILLING_URL = (process.env.EXPO_PUBLIC_BILLING_URL ?? '').replace(/\/$/, '');
/**
 * 'link' shows buy buttons that open Stripe checkout. 'hidden' only points
 * people to the website: use it for store regions that don't allow linking
 * out to web payments.
 */
export const BILLING_MODE: 'link' | 'hidden' =
  process.env.EXPO_PUBLIC_BILLING_MODE === 'hidden' || !BILLING_URL ? 'hidden' : 'link';
export const BILLING_WEBSITE = process.env.EXPO_PUBLIC_BILLING_WEBSITE ?? '';
const RETURN_URL = 'appname://billing';

export type Credits = {
  plan: string;
  plan_label: string;
  monthly_credits: number;
  batch_limit: number;
  plan_credits: number;
  pack_credits: number;
  in_flight: number;
  /** Videos that can still be started right now. */
  available: number;
  period_end: string;
  has_subscription: boolean;
};

export type PlanOption = {
  key: string;
  label: string;
  monthly_credits: number;
  batch_limit: number;
  price_cents: number;
  purchasable: boolean;
};

export type PackOption = { key: string; label: string; credits: number; price_cents: number; purchasable: boolean };

export function formatPrice(cents: number, perMonth = false): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(2)}${perMonth ? '/mo' : ''}`;
}

// ---------------------------------------------------------------------------
// Credits, shared across screens and refreshed after anything that changes them
// ---------------------------------------------------------------------------

let credits: Credits | null = null;
const listeners = new Set<() => void>();

export async function refreshCredits(): Promise<Credits | null> {
  const { data, error } = await supabase.rpc('get_my_credits');
  if (error) {
    console.warn('Could not load credits', error);
    return credits;
  }
  credits = ((data as Credits[] | null) ?? [])[0] ?? null;
  listeners.forEach((l) => l());
  return credits;
}

export function useCredits(): Credits | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => credits,
  );
}

/** Videos per batch on the current plan (10 until credits have loaded). */
export function batchLimitOf(c: Credits | null): number {
  return c?.batch_limit ?? BATCH_LIMIT;
}

export async function fetchPlans(): Promise<PlanOption[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('key, label, monthly_credits, batch_limit, price_cents, stripe_price_id')
    .order('sort');
  if (error) throw error;
  return data.map(({ stripe_price_id, ...p }) => ({ ...p, purchasable: Boolean(stripe_price_id) }) as PlanOption);
}

export async function fetchPacks(): Promise<PackOption[]> {
  const { data, error } = await supabase
    .from('credit_packs')
    .select('key, label, credits, price_cents, stripe_price_id')
    .order('sort');
  if (error) throw error;
  return data.map(({ stripe_price_id, ...p }) => ({ ...p, purchasable: Boolean(stripe_price_id) }) as PackOption);
}

// ---------------------------------------------------------------------------
// Checkout and subscription management
// ---------------------------------------------------------------------------

async function billingRequest(path: string, body: object = {}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in to continue.');
  const res = await fetch(`${BILLING_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Payments are unavailable right now. Please try again.');
  return json.url;
}

/**
 * Opens Stripe in an in-app browser. The billing server's return page sends
 * the browser back to appname://billing, which closes it. Credits arrive by
 * webhook a moment later, so this polls briefly for the change.
 */
async function openStripe(url: string): Promise<'success' | 'cancel'> {
  const before = credits;
  const result = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
  const status = result.type === 'success' && result.url.includes('status=cancel') ? 'cancel' : 'success';
  for (let i = 0; i < 6; i++) {
    const now = await refreshCredits();
    if (
      !before ||
      !now ||
      now.plan !== before.plan ||
      now.plan_credits + now.pack_credits !== before.plan_credits + before.pack_credits
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return result.type === 'success' ? status : 'cancel';
}

export async function buy(kind: 'plan' | 'pack', key: string): Promise<'success' | 'cancel'> {
  return openStripe(await billingRequest('/checkout', { kind, key }));
}

/** Stripe's portal: change plan, update card, cancel. */
export async function manageSubscription(): Promise<void> {
  await openStripe(await billingRequest('/portal'));
}

export class InsufficientCreditsError extends Error {
  constructor(
    public needed: number,
    public available: number,
  ) {
    super(
      available === 0 ? 'You’re out of credits for now.' : `This needs ${needed} credits and you have ${available}.`,
    );
  }
}

/** Server-side check failed with our trigger's message. */
export function isInsufficientCredits(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    String((err as { message?: string }).message).includes('insufficient_credits')
  );
}
