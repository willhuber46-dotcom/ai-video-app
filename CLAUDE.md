# [App Name]

AI video editor for TikTok Shop affiliates. The spec is in `docs/SPEC.md` and gets built phase by phase (see the README status table).

- `apps/mobile`: Expo app. Read `apps/mobile/AGENTS.md` before touching Expo APIs, because SDK 57 changed many of them.
- `worker`: Node/TS + FFmpeg job runner. The pure cutting logic is in `src/cuts.ts`.
- `packages/shared`: types and mode definitions shared by both.
- `supabase/migrations`: schema, RLS and the storage and queue setup. Add a new migration file; don't edit applied ones.

Every AI edit is a suggestion the user can change or remove. Keep that true for new features.

Checks: `npm run typecheck`, `npm test`, `npm run lint -w mobile`.
