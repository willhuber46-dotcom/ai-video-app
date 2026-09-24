import type { AddressInfo } from 'node:net';

import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { BillingStore, Pack, Plan } from '../src/billing/handlers';
import { createBillingServer } from '../src/billing/server';

const SECRET = 'whsec_test_secret';

/** In-memory store that behaves like the SQL functions (idempotent by ref). */
class FakeStore implements BillingStore {
  refs = new Set<string>();
  grants: { kind: string; userId: string; value: string | number; ref: string; periodEnd?: Date }[] = [];
  ended: string[] = [];
  customers = new Map<string, string>();

  async plans(): Promise<Plan[]> {
    return [
      { key: 'free', stripe_price_id: null, monthly_credits: 10 },
      { key: 'creator', stripe_price_id: 'price_creator', monthly_credits: 100 },
      { key: 'pro', stripe_price_id: 'price_pro', monthly_credits: 300 },
    ];
  }
  async packs(): Promise<Pack[]> {
    return [{ key: 'pack_25', stripe_price_id: 'price_pack25', credits: 25 }];
  }
  async userForCustomer(customerId: string) {
    return [...this.customers].find(([, c]) => c === customerId)?.[0] ?? null;
  }
  async customerForUser(userId: string) {
    return this.customers.get(userId) ?? null;
  }
  async saveCustomer(userId: string, customerId: string) {
    this.customers.set(userId, customerId);
  }
  async grantPlan(userId: string, plan: string, periodEnd: Date, ref: string) {
    if (this.refs.has(ref)) return false;
    this.refs.add(ref);
    this.grants.push({ kind: 'plan', userId, value: plan, ref, periodEnd });
    return true;
  }
  async grantPack(userId: string, credits: number, ref: string) {
    if (this.refs.has(ref)) return false;
    this.refs.add(ref);
    this.grants.push({ kind: 'pack', userId, value: credits, ref });
    return true;
  }
  async endSubscription(userId: string) {
    this.ended.push(userId);
  }
}

const stripe = new Stripe('sk_test_not_used');
const created: { customers: unknown[]; sessions: Record<string, unknown>[] } = { customers: [], sessions: [] };
// Stand-ins for the Stripe API calls the server makes.
Object.assign(stripe.customers, {
  create: async (params: unknown) => {
    created.customers.push(params);
    return { id: `cus_${created.customers.length}` };
  },
});
Object.assign(stripe.checkout.sessions, {
  create: async (params: Record<string, unknown>) => {
    created.sessions.push(params);
    return { url: `https://checkout.stripe.test/${created.sessions.length}` };
  },
});
Object.assign(stripe.subscriptions, {
  retrieve: async (id: string) => ({
    id,
    customer: 'cus_1',
    metadata: { user_id: 'user-1' },
    status: 'active',
    items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_900_000_000 }] },
  }),
});

let store: FakeStore;
let base: string;
const server = createBillingServer({
  stripe,
  get store() {
    return store;
  },
  webhookSecret: SECRET,
  publicUrl: 'https://billing.example.com',
  appScheme: 'appname',
  authenticate: async (token) => (token === 'good-token' ? { id: 'user-1', email: 'a@b.co' } : null),
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  store = new FakeStore();
  created.customers.length = 0;
  created.sessions.length = 0;
});

async function sendEvent(event: object, secret = SECRET) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${base}/stripe/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body: payload,
  });
}

const event = (type: string, object: object, id = `evt_${Math.random()}`) => ({
  id,
  object: 'event',
  type,
  data: { object },
});

describe('Stripe webhooks', () => {
  it('rejects events with a bad signature', async () => {
    const res = await sendEvent(event('invoice.paid', {}), 'whsec_wrong');
    expect(res.status).toBe(400);
    expect(store.grants).toEqual([]);
  });

  it('starts a plan period on a paid invoice, once even if Stripe retries', async () => {
    const invoice = event('invoice.paid', {
      id: 'in_1',
      parent: { subscription_details: { subscription: 'sub_1' } },
    });
    expect((await sendEvent(invoice)).status).toBe(200);
    expect((await sendEvent(invoice)).status).toBe(200);
    expect(store.grants).toEqual([
      { kind: 'plan', userId: 'user-1', value: 'pro', ref: 'invoice:in_1', periodEnd: new Date(1_900_000_000_000) },
    ]);
  });

  it('adds pack credits when a pack checkout is paid', async () => {
    await sendEvent(
      event('checkout.session.completed', {
        id: 'cs_1',
        mode: 'payment',
        payment_status: 'paid',
        client_reference_id: 'user-1',
        metadata: { pack: 'pack_25', user_id: 'user-1' },
      }),
    );
    expect(store.grants).toEqual([{ kind: 'pack', userId: 'user-1', value: 25, ref: 'checkout:cs_1' }]);
  });

  it('ignores subscription checkouts (the invoice grants those) and unpaid sessions', async () => {
    await sendEvent(event('checkout.session.completed', { id: 'cs_2', mode: 'subscription', payment_status: 'paid' }));
    await sendEvent(event('checkout.session.completed', { id: 'cs_3', mode: 'payment', payment_status: 'unpaid' }));
    expect(store.grants).toEqual([]);
  });

  it('moves the user back to Free when the subscription ends', async () => {
    await sendEvent(
      event('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1', metadata: { user_id: 'user-1' } }),
    );
    expect(store.ended).toEqual(['user-1']);
  });
});

describe('checkout', () => {
  const post = (path: string, body: object, token?: string) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it('needs a signed-in user', async () => {
    expect((await post('/checkout', { kind: 'plan', key: 'pro' })).status).toBe(401);
    expect((await post('/checkout', { kind: 'plan', key: 'pro' }, 'bad-token')).status).toBe(401);
  });

  it('creates a subscription checkout, reusing one Stripe customer per user', async () => {
    const first = await post('/checkout', { kind: 'plan', key: 'creator' }, 'good-token');
    expect(await first.json()).toEqual({ url: 'https://checkout.stripe.test/1' });
    await post('/checkout', { kind: 'pack', key: 'pack_25' }, 'good-token');

    expect(created.customers).toHaveLength(1);
    expect(created.sessions[0]).toMatchObject({
      mode: 'subscription',
      customer: 'cus_1',
      client_reference_id: 'user-1',
      line_items: [{ price: 'price_creator', quantity: 1 }],
      subscription_data: { metadata: { user_id: 'user-1', plan: 'creator' } },
      success_url: 'https://billing.example.com/return?status=success',
    });
    expect(created.sessions[1]).toMatchObject({ mode: 'payment', metadata: { pack: 'pack_25', user_id: 'user-1' } });
  });

  it('refuses plans that are not for sale', async () => {
    const res = await post('/checkout', { kind: 'plan', key: 'free' }, 'good-token');
    expect(res.status).toBe(400);
  });
});

describe('return page', () => {
  it('sends the browser back into the app', async () => {
    const html = await (await fetch(`${base}/return?status=success`)).text();
    expect(html).toContain('appname://billing?status=success');
    expect(html).toContain('Payment complete.');
  });

  it('never echoes arbitrary input into the page', async () => {
    const html = await (
      await fetch(`${base}/return?status=${encodeURIComponent('"><script>alert(1)</script>')}`)
    ).text();
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('appname://billing?status=done');
  });
});
