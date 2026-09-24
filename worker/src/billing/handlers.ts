import type Stripe from 'stripe';

/**
 * Stripe -> credits. Every change arrives as a webhook event; each grant
 * carries the Stripe id it came from, so retried events never grant twice.
 */

export type Plan = { key: string; stripe_price_id: string | null; monthly_credits: number };
export type Pack = { key: string; stripe_price_id: string | null; credits: number };

/** The database side of billing (implemented over Supabase in store.ts). */
export interface BillingStore {
  plans(): Promise<Plan[]>;
  packs(): Promise<Pack[]>;
  userForCustomer(customerId: string): Promise<string | null>;
  customerForUser(userId: string): Promise<string | null>;
  saveCustomer(userId: string, customerId: string): Promise<void>;
  grantPlan(userId: string, plan: string, periodEnd: Date, ref: string, subscriptionId: string): Promise<boolean>;
  grantPack(userId: string, credits: number, ref: string): Promise<boolean>;
  endSubscription(userId: string): Promise<void>;
}

export type BillingDeps = { stripe: Stripe; store: BillingStore };

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === 'string' ? x : (x?.id ?? null));

async function userFor(sub: Stripe.Subscription, store: BillingStore): Promise<string | null> {
  return sub.metadata?.user_id || (await store.userForCustomer(idOf(sub.customer)!));
}

/** A paid period: which plan it is, until when, and for whom. */
async function applySubscriptionPeriod(sub: Stripe.Subscription, ref: string, deps: BillingDeps): Promise<string> {
  const item = sub.items.data[0];
  const priceId = item?.price?.id;
  const plan = (await deps.store.plans()).find((p) => p.stripe_price_id && p.stripe_price_id === priceId);
  if (!plan) return `ignored: price ${priceId} is not a plan`;
  const userId = await userFor(sub, deps.store);
  if (!userId) return `ignored: no user for subscription ${sub.id}`;
  const granted = await deps.store.grantPlan(userId, plan.key, new Date(item.current_period_end * 1000), ref, sub.id);
  return granted ? `granted ${plan.key} to ${userId}` : 'already applied';
}

export async function handleEvent(event: Stripe.Event, deps: BillingDeps): Promise<string> {
  const { stripe, store } = deps;
  switch (event.type) {
    // One-time credit packs are granted when checkout completes.
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'payment' || session.payment_status !== 'paid') return 'ignored: not a paid pack purchase';
      const userId = session.client_reference_id ?? session.metadata?.user_id;
      const pack = (await store.packs()).find((p) => p.key === session.metadata?.pack);
      if (!userId || !pack) return 'ignored: missing user or pack';
      return (await store.grantPack(userId, pack.credits, `checkout:${session.id}`))
        ? `granted ${pack.key}`
        : 'already applied';
    }

    // Every paid invoice (first payment, renewal, upgrade) starts a period with fresh credits.
    case 'invoice.paid': {
      const invoice = event.data.object;
      const subId = idOf(invoice.parent?.subscription_details?.subscription);
      if (!subId) return 'ignored: not a subscription invoice';
      const sub = await stripe.subscriptions.retrieve(subId);
      return applySubscriptionPeriod(sub, `invoice:${invoice.id}`, deps);
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const userId = await userFor(sub, store);
      if (!userId) return 'ignored: no user';
      await store.endSubscription(userId);
      return `ended subscription for ${userId}`;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
        const userId = await userFor(sub, store);
        if (userId) await store.endSubscription(userId);
        return `ended subscription (${sub.status})`;
      }
      // Plan changes take effect with the invoice Stripe sends for them.
      return 'ignored: handled by invoice.paid';
    }

    default:
      return `ignored: ${event.type}`;
  }
}

export type CheckoutRequest = { kind: 'plan'; key: string } | { kind: 'pack'; key: string };

/** Reuses the user's Stripe customer, so all purchases share one billing history. */
async function customerFor(user: { id: string; email?: string }, deps: BillingDeps): Promise<string> {
  const existing = await deps.store.customerForUser(user.id);
  if (existing) return existing;
  const customer = await deps.stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
  await deps.store.saveCustomer(user.id, customer.id);
  return customer.id;
}

/** A Stripe-hosted checkout page for a plan or a credit pack. */
export async function createCheckout(
  user: { id: string; email?: string },
  request: CheckoutRequest,
  deps: BillingDeps & { returnUrl: string },
): Promise<string> {
  const customer = await customerFor(user, deps);
  const success = `${deps.returnUrl}?status=success`;
  const cancel = `${deps.returnUrl}?status=cancel`;

  if (request.kind === 'plan') {
    const plan = (await deps.store.plans()).find((p) => p.key === request.key);
    if (!plan?.stripe_price_id) throw new BillingError(400, 'That plan is not for sale.');
    const session = await deps.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      subscription_data: { metadata: { user_id: user.id, plan: plan.key } },
      success_url: success,
      cancel_url: cancel,
    });
    return session.url!;
  }

  const pack = (await deps.store.packs()).find((p) => p.key === request.key);
  if (!pack?.stripe_price_id) throw new BillingError(400, 'That credit pack is not for sale.');
  const session = await deps.stripe.checkout.sessions.create({
    mode: 'payment',
    customer,
    client_reference_id: user.id,
    line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
    metadata: { user_id: user.id, pack: pack.key },
    success_url: success,
    cancel_url: cancel,
  });
  return session.url!;
}

/** Stripe's page for changing plan, updating the card or cancelling. */
export async function createPortal(userId: string, deps: BillingDeps & { returnUrl: string }): Promise<string> {
  const customer = await deps.store.customerForUser(userId);
  if (!customer) throw new BillingError(400, 'You don’t have a subscription yet.');
  const session = await deps.stripe.billingPortal.sessions.create({
    customer,
    return_url: `${deps.returnUrl}?status=portal`,
  });
  return session.url;
}

export class BillingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
