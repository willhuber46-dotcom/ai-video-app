-- Phase 1: accounts, videos, the processing queue, cost logging and storage.

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, created automatically on sign up.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  -- "I record in:" preference, used for transcription and captions.
  record_language text not null default 'en',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Batches and videos. Phase 1 creates a batch of one; Phase 3 fills it up to 10.
-- ---------------------------------------------------------------------------
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.batches enable row level security;

create policy "batches: read own" on public.batches
  for select using (auth.uid() = user_id);
create policy "batches: create own" on public.batches
  for insert with check (auth.uid() = user_id);

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid references public.batches (id) on delete cascade,
  mode text not null default 'talking'
    check (mode in ('talking', 'no_talking', 'voiceover', 'before_after', 'unboxing_asmr')),
  clip_type text not null default 'single' check (clip_type in ('single', 'multiple')),
  pacing text not null default 'natural' check (pacing in ('tight', 'natural', 'loose')),
  status text not null default 'uploading'
    check (status in ('uploading', 'queued', 'editing', 'done', 'failed')),
  error text,
  raw_path text,
  source_duration_s numeric,
  output_path text,
  thumbnail_path text,
  output_duration_s numeric,
  transcript jsonb,
  edit_decisions jsonb,
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz
);

create index videos_user_created_idx on public.videos (user_id, created_at desc);
create index videos_queue_idx on public.videos (created_at) where status = 'queued';

alter table public.videos enable row level security;

create policy "videos: read own" on public.videos
  for select using (auth.uid() = user_id);

-- Users create their own videos, and only in the 'uploading' state.
create policy "videos: create own" on public.videos
  for insert with check (auth.uid() = user_id and status = 'uploading');

-- Users may only move their own video from uploading to queued (or mark an
-- upload failed). Everything after that is written by the worker, which uses
-- the service role and bypasses RLS.
create policy "videos: submit own" on public.videos
  for update
  using (auth.uid() = user_id and status in ('uploading', 'failed'))
  with check (auth.uid() = user_id and status in ('uploading', 'queued', 'failed'));

-- Column-level guard: the app can only touch these columns.
revoke insert, update on public.videos from authenticated, anon;
grant insert (batch_id, mode, clip_type, pacing, raw_path, source_duration_s)
  on public.videos to authenticated;
grant update (status, raw_path, source_duration_s, error, mode, pacing)
  on public.videos to authenticated;

create policy "videos: delete own" on public.videos
  for delete using (auth.uid() = user_id);

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger videos_touch_updated_at
  before update on public.videos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Worker queue: atomically claim the oldest queued video. Stale 'editing'
-- rows (a worker died mid-job) are re-claimed after 30 minutes, up to 3 tries.
-- ---------------------------------------------------------------------------
create function public.claim_next_video()
returns setof public.videos
language plpgsql
security definer set search_path = ''
as $$
begin
  return query
  update public.videos v
     set status = 'editing',
         locked_at = now(),
         attempts = v.attempts + 1,
         error = null
   where v.id = (
     select c.id
       from public.videos c
      where (c.status = 'queued')
         or (c.status = 'editing' and c.locked_at < now() - interval '30 minutes' and c.attempts < 3)
      order by c.created_at
      for update skip locked
      limit 1
   )
  returning v.*;
end;
$$;

revoke execute on function public.claim_next_video() from public, anon, authenticated;
grant execute on function public.claim_next_video() to service_role;

-- ---------------------------------------------------------------------------
-- Cost tracking: one row per billable step (transcription, AI call, compute).
-- Only the service role reads or writes this table.
-- ---------------------------------------------------------------------------
create table public.processing_costs (
  id bigint generated always as identity primary key,
  video_id uuid references public.videos (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('transcription', 'ai', 'compute')),
  provider text not null,
  units numeric not null,
  unit text not null,
  usd numeric(12, 6) not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index processing_costs_video_idx on public.processing_costs (video_id);

alter table public.processing_costs enable row level security;

-- ---------------------------------------------------------------------------
-- Storage. Files live under "<user id>/<video id>.<ext>".
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('raw-uploads', 'raw-uploads', false, 2147483648, array['video/*']),
  ('cuts', 'cuts', false, 2147483648, array['video/mp4', 'image/jpeg']);

create policy "raw-uploads: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'raw-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- Upserts (re-uploading after a failed attempt) need select + update as well.
create policy "raw-uploads: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'raw-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "raw-uploads: overwrite own" on storage.objects
  for update to authenticated
  using (bucket_id = 'raw-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "cuts: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'cuts' and (storage.foldername(name))[1] = auth.uid()::text);
