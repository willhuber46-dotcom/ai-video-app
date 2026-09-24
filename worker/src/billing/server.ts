import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  BillingError,
  createCheckout,
  createPortal,
  handleEvent,
  type BillingDeps,
  type CheckoutRequest,
} from './handlers';

/**
 * A small HTTP API for payments:
 *   POST /checkout        {kind: 'plan'|'pack', key}  -> {url}   (signed-in user)
 *   POST /portal                                      -> {url}   (signed-in user)
 *   POST /stripe/webhook  Stripe events, signature-checked
 *   GET  /return          page Stripe sends people back to; it reopens the app
 *   GET  /health
 */

export type BillingUser = { id: string; email?: string };

export type BillingServerOptions = BillingDeps & {
  /** Resolves a Supabase access token to the signed-in user, or null. */
  authenticate: (token: string) => Promise<BillingUser | null>;
  webhookSecret: string;
  /** Public URL of this server, e.g. https://billing.example.com */
  publicUrl: string;
  /** The app's URL scheme, e.g. "appname" -> appname://billing */
  appScheme: string;
};

const MAX_BODY = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) reject(new BillingError(413, 'Request too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page Stripe returns to; it hands control back to the app. */
function returnPage(appScheme: string, status: string): string {
  const safe = /^[a-z]+$/.test(status) ? status : 'done';
  const target = `${appScheme}://billing?status=${safe}`;
  const message = safe === 'success' ? 'Payment complete.' : safe === 'cancel' ? 'Checkout cancelled.' : 'All set.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>[App Name]</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}a{display:inline-block;margin-top:16px;padding:14px 22px;border-radius:14px;background:#FE2C55;color:#fff;text-decoration:none;font-weight:600}</style>
</head><body><div><h2>${escapeHtml(message)}</h2><a href="${escapeHtml(target)}">Back to [App Name]</a></div>
<script>location.href=${JSON.stringify(target)};</script></body></html>`;
}

async function requireUser(req: IncomingMessage, opts: BillingServerOptions): Promise<BillingUser> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? await opts.authenticate(token) : null;
  if (!user) throw new BillingError(401, 'Sign in to continue.');
  return user;
}

export function createBillingServer(opts: BillingServerOptions): Server {
  const returnUrl = `${opts.publicUrl.replace(/\/$/, '')}/return`;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });

      if (req.method === 'GET' && url.pathname === '/return') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(returnPage(opts.appScheme, url.searchParams.get('status') ?? 'done'));
      }

      if (req.method === 'POST' && url.pathname === '/stripe/webhook') {
        const body = await readBody(req);
        let event;
        try {
          event = opts.stripe.webhooks.constructEvent(
            body,
            String(req.headers['stripe-signature'] ?? ''),
            opts.webhookSecret,
          );
        } catch {
          return json(res, 400, { error: 'Invalid signature' });
        }
        const outcome = await handleEvent(event, opts);
        console.log(`Stripe ${event.type} ${event.id}: ${outcome}`);
        return json(res, 200, { received: true });
      }

      if (req.method === 'POST' && url.pathname === '/checkout') {
        const user = await requireUser(req, opts);
        const body = JSON.parse((await readBody(req)).toString() || '{}') as Partial<CheckoutRequest>;
        if ((body.kind !== 'plan' && body.kind !== 'pack') || typeof body.key !== 'string') {
          throw new BillingError(400, 'Choose a plan or a credit pack.');
        }
        const checkoutUrl = await createCheckout(user, { kind: body.kind, key: body.key }, { ...opts, returnUrl });
        return json(res, 200, { url: checkoutUrl });
      }

      if (req.method === 'POST' && url.pathname === '/portal') {
        const user = await requireUser(req, opts);
        return json(res, 200, { url: await createPortal(user.id, { ...opts, returnUrl }) });
      }

      json(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof BillingError) return json(res, err.status, { error: err.message });
      console.error('Billing request failed', err);
      // Stripe retries webhooks on 5xx, which is what we want for transient errors.
      json(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  });
}
