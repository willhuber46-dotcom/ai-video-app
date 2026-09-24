import { batchFinishedMessage } from '@app/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export interface PushSender {
  /** Sends the messages; returns tokens the push service says are dead. */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

type ExpoTicket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK = 100;

/** Expo's push service, which forwards to APNs and FCM. */
export class ExpoPushSender implements PushSender {
  constructor(
    private accessToken?: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
      const chunk = messages.slice(i, i + EXPO_CHUNK);
      const res = await this.fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(chunk.map((m) => ({ ...m, sound: 'default' }))),
      });
      if (!res.ok) throw new Error(`Expo push ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const { data } = (await res.json()) as { data: ExpoTicket[] };
      data.forEach((ticket, j) => {
        if (ticket.status === 'error') {
          if (ticket.details?.error === 'DeviceNotRegistered') invalidTokens.push(chunk[j].to);
          else console.warn(`Push to ${chunk[j].to} failed: ${ticket.message}`);
        }
      });
    }
    return { invalidTokens };
  }
}

/**
 * Called after each video finishes. When it was the last one in its batch,
 * tells the user's devices. complete_batch() makes sure this happens once.
 */
export async function notifyIfBatchComplete(db: SupabaseClient, batchId: string, sender: PushSender): Promise<boolean> {
  const { data, error } = await db.rpc('complete_batch', { p_batch_id: batchId });
  if (error) throw error;
  const result = (data as { user_id: string; total: number; done: number; failed: number }[] | null)?.[0];
  if (!result) return false;

  const { data: tokens, error: tokenError } = await db
    .from('push_tokens')
    .select('token')
    .eq('user_id', result.user_id);
  if (tokenError) throw tokenError;
  if (!tokens?.length) return true;

  const { title, body } = batchFinishedMessage(result.total, result.done, result.failed);
  const { invalidTokens } = await sender.send(
    tokens.map((t) => ({ to: t.token as string, title, body, data: { batchId } })),
  );
  if (invalidTokens.length) await db.from('push_tokens').delete().in('token', invalidTokens);
  return true;
}
