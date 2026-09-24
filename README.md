# [App Name]

A mobile-first AI video editor for TikTok Shop affiliates: upload raw footage, pick a style, get back a post-ready video. The full product spec is in [docs/SPEC.md](docs/SPEC.md).

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 1. Core | Sign up / log in, Batch tab with single-clip upload, Talking Mode cutting, preview, save to camera roll | **Built** |
| 2. Editing tools | Auto Captions, Auto Zoom, Suggested Text, safe zones | **Built** |
| 3. Batching | Up to 10 videos, per-video mode, "Set all to...", background uploads, progress, push | **Built** |
| 4. Tabs | Cuts tab, Profile, Settings, 30-day auto-delete | **Built** (plan and credits are placeholders until Phase 7) |
| 5. More modes | No Talking, Voiceover, Before & After, Unboxing / ASMR, Multiple Clips | Shown as "Coming soon" |
| 6. Create tab | In-app camera | Placeholder only |
| 7. Money | Credits, plans, payments, tutorial | Not started |

## How it works

```
 Expo app (iOS / Android)                Supabase                      Worker (Docker, Node + FFmpeg)
 ─────────────────────────              ──────────                    ──────────────────────────────
 pick video ──insert row──────────────▶ videos (status=uploading)
            ──stream file─────────────▶ storage: raw-uploads/
            ──status=queued───────────▶ videos        ◀── claim_next_video() ── poll every 3s
                                                                         download raw
                                                                         FFmpeg: extract audio
                                                                         Deepgram: words + timings
                                                                         Claude: find retakes
                                                                         cut pauses / fillers / retakes
                                                                         FFmpeg: render 1080x1920 MP4
                                        storage: cuts/  ◀────────────── upload cut + thumbnail
 poll status ◀────────────────────────  videos (status=done)  ◀──────── save edit + transcript, log costs,
 preview + save to camera roll                                           delete raw upload
```

- **`apps/mobile`**: Expo SDK 57 + Expo Router. Four native tabs (Create, Batch, Cuts, Profile). The upload streams the file from disk to Supabase Storage, and on iOS it keeps going if the user switches apps.
- **`worker`**: a TypeScript job runner. Talking Mode transcribes with Deepgram Nova-3 (filler words kept on purpose), drops fillers, cuts pauses longer than the pacing allows (Tight / Natural / Loose), and removes retakes and false starts. Retakes are chosen by Claude (`claude-opus-5`, structured output), with a built-in heuristic as the fallback. Every kept range is encoded separately and joined losslessly, so audio stays in sync even on variable-frame-rate phone video. Each cut gets a tiny audio fade so there are no clicks.
- **Editing tools (Phase 2)**: the preview screen is an editor with **Auto Captions**, **Suggested Text** and **Auto Zoom** buttons along the bottom. Each button adds the AI's suggestion the first time you tap it, then opens its controls:
  - **Captions**: three styles (bold pop-up words, clean minimal, highlighted keyword). You can fix or delete any word, and drag the captions up or down.
  - **Text**: the AI's hooks (e.g. "the best fall sweats 🍂") with the alternatives as one-tap swaps. You can edit the words, font (5 choices), color, box or plain style, size, and when it shows, and drag it anywhere.
  - **Zoom**: each zoom is a marker on the timeline that you can drag, lengthen, shorten, change the strength of, or delete. Tap the video to aim a zoom at the product, or add your own zoom at the playhead.
  - **Safe zones**: text and captions can't be placed where TikTok's top bar, side buttons or caption go, and faint guides show those areas while you edit.
- **Batches (Phase 3)**: **Add Videos** opens the camera roll with multi-select, up to 10 videos per batch. Each video gets its own mode and pacing from a sheet that shows every mode's description, and **Set all to…** applies one choice to every video. **Edit N videos** creates the batch, then starts every upload at once. Each batch shows live progress ("3 of 10 done") and a status per video (Uploading %, Editing, Done, Failed). Failed videos get a **Retry** button: it re-uploads from the phone if the upload failed, or re-queues the file already on the server if the edit failed.
- **Background uploads**: uploads go to signed upload URLs, so they don't depend on the login session (which expires after an hour), through iOS background URL sessions. A storage trigger queues each video the moment its file lands, so an upload that finishes after the app was suspended or killed still gets edited. Pending uploads are saved on the phone and resume the next time the Batch tab opens. On Android, uploads continue while the app is in memory and resume on the next open otherwise.
- **Push notifications**: the app asks for permission when you start your first batch and registers an Expo push token. After each video, the worker checks whether it was the last one in its batch; `complete_batch()` makes that true exactly once. It then sends "All 10 videos are ready ✂️" (or "8 of 10 are ready, 2 need another try") to your devices. Tapping it opens the Batch tab. Signing out removes the phone's token.
- **Cuts tab (Phase 4)**: every finished edit in a grid, grouped by batch, newest first. Each thumbnail shows the mode, the length, and a red "Deletes in 2 days" badge in a cut's last 3 days. Tap a cut to open the editor. **Select** (or long-press) to delete one or many; that removes the cut, its thumbnail and any final renders. **Save all** saves a whole batch to the camera roll, rendering each cut's captions, text and zooms first.
- **Profile and Settings**: Profile shows your name, cuts made (a lifetime count; tap it to open Cuts), your plan, cuts this month, and a gear icon for Settings. Settings follows the spec top to bottom:
  - **Account**: name and email. Changing the email sends a confirmation link.
  - **Subscription**: your plan, with a dropdown where paid plans show as "Coming soon".
  - **Preferences**: "I record in", which the worker uses for transcription.
  - **Support**: help and contact by email, "Refresh app data / clear storage" (refused while uploads still need their files), and Replay tutorial (coming soon).
  - **Legal**: links to the privacy policy and terms.
  - **Sign out**, and **Delete account** behind two confirmations.
- **30-day auto-delete and account deletion**: once a minute, one worker (chosen by a lease in the database) does the housekeeping:
  - It pushes "3 cuts will be deleted in 3 days"; tapping it opens Cuts.
  - It deletes expired cuts with all their files.
  - It clears failed or abandoned uploads older than 30 days.
  - It carries out account deletions: it empties the user's storage folders, then deletes the login, which removes all their data.
- **How edits are applied**: every edit is saved to `videos.overlays` as you go, and the app draws it live over the player. **Save to camera roll** queues a render, and the worker burns the same document into the MP4. Captions and text are drawn with the same fonts (Google Fonts TTFs bundled in both) and the same layout rules from `packages/shared`, with color emoji. Zooms use the same easing curve in the preview and in FFmpeg.
- **AI suggestions**: while cutting the video, the worker shows Claude a few stills plus the transcript. Claude names the product, writes 3 text hooks with emoji, and picks zoom moments with where the product sits in the frame. They're stored in `videos.ai_suggestions`. Without an Anthropic key, the worker still suggests zooms at sentence starts but offers no text ideas.
- **`packages/shared`**: mode names and descriptions, pacing options, statuses and row types, plus all the overlay layout math (caption grouping, zoom easing, safe zones, fonts).
- **`supabase/migrations`**: tables, row-level security, storage buckets and the job queue.

### Data and security

- `videos` tracks each edit: `uploading → queued → editing → done | failed`. The app can only create rows and move its own videos from uploading to queued. Everything after that is written by the worker with the service role. Column grants stop the app from writing output paths, transcripts or status `done`.
- Storage paths are `<user id>/<video id>.<ext>`. Users can upload only into their own folder and read only their own cuts, through signed URLs.
- Raw uploads are deleted as soon as a video finishes. A failed edit keeps the raw file so **Retry** works without uploading again.
- `processing_costs` logs one row per billable step (Deepgram minutes, Claude tokens, worker seconds), so pricing can be set per video. Rates are configurable in `worker/.env`.
- The worker stores the kept words **on the edited timeline** (`videos.transcript`); Auto Captions starts from them.
- Overlays are saved through `save_overlays()` and renders are queued through `request_render()`. Both are database functions that check the video belongs to the caller and is finished. The worker takes renders before new edits, since the user is waiting on them. Only the newest final render per video is kept in storage.

## Setup

Requirements: Node 22+, FFmpeg and a color emoji font (`fonts-noto-color-emoji` on Debian/Ubuntu) for local worker runs, a Supabase project, a Deepgram API key, and optionally an Anthropic API key.

```bash
npm install
```

### 1. Supabase

1. Create a project at supabase.com.
2. Apply the migration, either with the CLI (`supabase link` then `supabase db push`) or by pasting `supabase/migrations/*.sql` into the SQL editor.
3. Under Authentication → Providers, keep Email enabled. For quick testing you can turn off "Confirm email".
4. If you're on the Free plan, raise the global upload size limit under Storage → Settings. The buckets allow up to 2 GB, but the project-wide cap wins.

### 2. Worker

```bash
cp worker/.env.example worker/.env   # fill in Supabase URL + service role key, Deepgram key, Anthropic key
npm run worker                       # polls the queue and edits videos
```

Try Talking Mode on a local file without Supabase:

```bash
npm run cut -w worker -- ~/Movies/raw.mp4 --pacing tight --out ~/Movies/cut.mp4
```

This writes the cut plus a `.json` file listing what was kept and removed.

Deploy it as a container, built from the repo root:

```bash
docker build -f worker/Dockerfile -t app-worker .
docker run --env-file worker/.env app-worker
```

Any container host works (Fly.io, Railway, Render, ECS). Scale by running more containers or raising `WORKER_CONCURRENCY`, because the queue hands each video to exactly one worker.

### 3. Push notifications

Pushes go through Expo's push service, which needs an EAS project and credentials:

1. `cd apps/mobile && npx eas-cli init`. This adds `extra.eas.projectId` to the app config.
2. `npx eas-cli credentials`: add an APNs key for iOS and an FCM key for Android. EAS walks you through both.
3. Optional: if you turn on "enhanced push security" in Expo, set `EXPO_ACCESS_TOKEN` in `worker/.env`.

Without a project id, the app still works but skips push registration.

### 4. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # Supabase URL + anon key; optional support email and legal URLs
npm run mobile                                 # Expo dev server
```

The app uses native modules (native tabs, background upload, media library), so run it in a development build: `npx expo run:ios`, `npx expo run:android`, or `npx eas-cli build --profile development`. Expo Go won't work.

## Checks

```bash
npm run typecheck                  # all packages
npm test                           # worker: cutting + overlay logic, real FFmpeg renders
npm run lint -w mobile
```

## Tech choices

| Area | Choice |
| --- | --- |
| Mobile | Expo (React Native), one TypeScript codebase for iPhone and Android |
| Accounts, database, storage | Supabase (Postgres + RLS, Auth, Storage) |
| Video processing | Node/TypeScript worker in Docker with FFmpeg |
| Speech-to-text | Deepgram Nova-3 |
| AI | Claude (`claude-opus-5`) for retakes, text hooks and zoom moments; best moments later |
| Overlay rendering | `@napi-rs/canvas` (Skia) draws captions and text; FFmpeg handles zooms and compositing |
| Payments | To decide in Phase 7 (RevenueCat is the usual choice for App Store + Play subscriptions) |
