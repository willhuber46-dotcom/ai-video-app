# TikTok Shop Editing App — Build Spec

Sep 24, 2026 · @Will Huber

## Overview

[App Name] is a mobile-first AI video editor for TikTok Shop affiliates: upload raw footage, pick a style, and get back a finished, post-ready video. Competitors (Cut AI, TikCut, TikEditor) mostly just cut dead space; this app also adds captions, auto zoom, on-screen text, and five video-style modes.

- **Who it's for:** TikTok Shop affiliates who film a lot and hate editing.
- **Core promise:** film, upload, post. No editing skills needed.
- **Rule for every AI suggestion:** it's a suggestion. Captions, text, and zooms are always editable or removable by the user.
- **App name, colors, and logo:** to be decided. Use [App Name] as a placeholder.

## Navigation

The app has four tabs in a bottom navigation bar, in this order:

| Tab | Purpose |
| --- | --- |
| Create | Record video inside the app |
| Batch | Add videos, pick modes, start editing |
| Cuts | All finished edits (tab name may change later) |
| Profile | Account stats, plan, settings |

## Create tab

An in-app camera so users can film without leaving the app.

- Record length options: 60 seconds, 3 minutes, 10 minutes.
- Flash toggle.
- Flip camera (front/back).
- After recording stops, go straight to the mode picker, then send the video into a batch. The user never has to go find the video again.
- Option to save the raw recording to the camera roll.

## Batch tab

Where editing starts: users add videos, choose a clip type and mode for each, then hit Edit.

**Adding videos**

- "Add Videos" button opens the camera roll with multi-select.
- Batch limit: **10 videos** at launch. Higher plans can raise it later (for example, 20 on the top plan).

**Clip type** (chosen per item)

- **Single Clip:** one long video trimmed down into one finished video. Best for Talking Mode.
- **Multiple Clips:** several clips combined into one finished video. Best for No Talking, Before & After, and Unboxing / ASMR.

**Mode per video**

- Each upload shows a thumbnail with its own mode picker, so video 1 can be Talking Mode and video 2 can be Unboxing / ASMR.
- A "Set all to..." button applies one mode to every video in the batch.
- The picker shows the mode name plus its short description (see Edit modes).

**Uploading**

- Uploads run in the background, so they keep going if the user switches apps.
- Failed uploads retry automatically and show a "Retry" button if they still fail.

## Edit modes

Five modes. Each shows its in-app description in the mode picker so users understand what it does.

| Mode | In-app description | What it does | Uses audio? |
| --- | --- | --- | --- |
| Talking Mode | For videos where you talk to the camera. We cut out the pauses, dead air, and retakes so only your best parts stay in. | Transcribes speech, removes silences, filler pauses, false starts, and repeated retakes. Pacing setting: Tight, Natural, or Loose. | Yes |
| No Talking Mode | For videos where you're just showing off a product, like outfits, home decor, or gadgets. We ignore the audio and cut to your best angles and moments. | Scene detection picks the best moments (turns, close-ups, product shown clearly), removes shaky or blurry parts, and cuts to a steady rhythm. Adds aesthetic on-screen text. | No. Show a note: "This mode doesn't use audio." |
| Voiceover Mode | Film your product clips, then record your voice separately. We match your clips to what you're saying. | User uploads silent clips plus a voice recording (or records one in-app). App transcribes the voice and places the most relevant clip under each line. | Voice track only |
| Before & After Mode | For transformations like cleaning, beauty, hair, or organizing. We find your before and after moments and add a smooth transition between them. | Detects the before and after states, adds a transition or split screen, and adds editable "Before" and "After" labels. | Optional |
| Unboxing / ASMR Mode | For unboxings and satisfying product videos. We keep the good sounds (tearing, clicking, pouring) and cut the slow parts. | Keeps moments with satisfying sounds, cuts slow fumbling and dead handling, adds light aesthetic text. | Yes, keeps product sounds |

Optional style/vibe presets (aesthetic, fall, Christmas, and similar) can apply on top of any mode: fonts, text style, and color tone. The app does not add music.

## Editing tools (all modes)

After a video is cut, the preview screen shows these as buttons along the bottom. Each one adds an AI suggestion the user can edit or remove.

- **Auto Captions:** transcribes speech and adds captions. The user picks a caption style (for example bold pop-up words, clean minimal, highlighted keyword). Captions are editable word by word.
- **Suggested Text:** AI analyzes the video and product, then suggests on-screen text such as "the best fall sweats" plus a fitting emoji. Fully editable: words, font, color, position.
- **Auto Zoom:** adds punch-in zooms when the product is on screen or being talked about. Each zoom shows as a marker on the timeline that the user can move, change, or delete, and users can add their own zooms.
- **Safe zones:** all text and captions stay out of the areas TikTok covers with its buttons and caption. Show faint guides while editing.

## Cuts tab

Every finished edit lands here.

- Grid of edited videos, newest first, with the mode shown on each thumbnail.
- Select mode to delete one or many videos.
- Tap a video to open the preview screen: play it, adjust captions, text, and zooms, then save to the camera roll.
- "Save all" to download a whole batch at once.
- Cuts auto-delete after 30 days. Show a warning on videos expiring within 3 days, and send a push notification before deletion.

## Profile and Settings

**Profile screen**

- Name.
- Number of cuts made. Tapping it opens the Cuts tab (no separate "all videos" list here).
- Current plan.
- Credits or videos remaining this month.
- Settings icon in the top corner.

**Settings screen** (top to bottom)

1. **Account:** profile name and email, both editable.
2. **Subscription:** current plan with a dropdown to change plans.
3. **Preferences:** "I record in:" dropdown with languages (English, Spanish, and more). Used for transcription and captions.
4. **Support:** Help and contact, Refresh app data / clear storage, Replay tutorial.
5. **Legal:** Privacy policy, Terms of service.
6. **Sign out** button.
7. **Delete account** button, with a confirmation step. Apple requires this for apps with accounts.

## Processing, notifications, storage, and credits

- **Progress:** the Batch tab shows live status per video (Uploading, Editing, Done, Failed) and overall progress such as "3 of 10 done".
- **Push notification** when a batch finishes, so users can close the app while it works.
- **Background uploads** continue when the app is not open.
- **Credits:** one credit = one finished video, with a max input length per credit (for example up to 10 minutes). Plans give a monthly number of credits. Show credits remaining on Profile and before starting a batch.
- **Storage:** finished cuts are kept for 30 days, then auto-deleted after a warning. Raw uploads are deleted from the server once editing finishes.
- **Cost tracking:** log processing cost per video (video processing, transcription, AI calls) so pricing can be set to cover it.

## Tech approach and build order

Build in phases and get each phase fully working before starting the next. Claude Code should ask before choosing the specific frameworks and services.

**Suggested tech (to confirm with Claude Code)**

- Mobile app built with a cross-platform framework (for example React Native with Expo) so one codebase covers iPhone and Android.
- Server that does the video editing with FFmpeg.
- Speech-to-text service for transcription and captions.
- AI model for suggested text and picking best moments.
- User accounts, database, and file storage from a backend service.
- Subscriptions and payments (note that Apple and Google take a cut of in-app subscriptions).

**Build order**

1. **Phase 1, core:** sign up and log in, Batch tab with single-clip upload, Talking Mode dead-space cutting, preview, save to camera roll.
2. **Phase 2, editing tools:** Auto Captions with styles, Auto Zoom, Suggested Text, safe zones.
3. **Phase 3, batching:** up to 10 videos, per-video mode picker, "Set all to...", background uploads, progress, push notifications.
4. **Phase 4, tabs:** Cuts tab, Profile, Settings, 30-day auto-delete.
5. **Phase 5, more modes:** No Talking Mode, then Voiceover, Before & After, Unboxing / ASMR. Add Multiple Clips support here.
6. **Phase 6, Create tab:** in-app camera with length options, flash, flip.
7. **Phase 7, money:** credits, subscription plans, payments, tutorial on first launch.
