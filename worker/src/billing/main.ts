import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { createBillingServer } from './server';
import { SupabaseBillingStore } from './store';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const db = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const server = createBillingServer({
  stripe: new Stripe(required('STRIPE_SECRET_KEY')),
  store: new SupabaseBillingStore(db),
  webhookSecret: required('STRIPE_WEBHOOK_SECRET'),
  publicUrl: required('BILLING_PUBLIC_URL'),
  appScheme: process.env.APP_SCHEME ?? 'appname',
  authenticate: async (token) => {
    const { data, error } = await db.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id, email: data.user.email };
  },
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => console.log(`Billing server listening on :${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
