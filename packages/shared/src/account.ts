import { CUT_RETENTION_DAYS } from './db';

/** "I record in:" options: languages Deepgram Nova-3 transcribes. */
export const RECORD_LANGUAGES: readonly { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'multi', label: 'English + Spanish (mixed)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
];

export function languageLabel(code: string): string {
  return RECORD_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

const DAY_MS = 86_400_000;

/** Whole days until a cut is deleted (0 = today), or null if it doesn't expire. */
export function daysUntilExpiry(expiresAt: string | null, now = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / DAY_MS));
}

/** Warning shown on cuts in their last 3 days, or null. */
export function expiryWarning(expiresAt: string | null, now = new Date()): string | null {
  const days = daysUntilExpiry(expiresAt, now);
  if (days === null || days >= 3) return null;
  if (days === 0) return 'Deletes today';
  return days === 1 ? 'Deletes tomorrow' : `Deletes in ${days} days`;
}

export function expiryPushMessage(cuts: number): { title: string; body: string } {
  return {
    title: cuts === 1 ? 'A cut will be deleted in 3 days' : `${cuts} cuts will be deleted in 3 days`,
    body: `Cuts are kept for ${CUT_RETENTION_DAYS} days. Save ${cuts === 1 ? 'it' : 'them'} to your camera roll to keep ${cuts === 1 ? 'it' : 'them'}.`,
  };
}
