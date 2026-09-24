-- Phase 3: batches of up to 10 videos, uploads that finish in the background,
-- and a push notification when a batch is done.

-- ---------------------------------------------------------------------------
-- Queue a video as soon as its raw file lands in storage. Background uploads
-- on iOS can finish after the app has been suspended or killed, so the server
-- can't rely on the app to report "upload finished".
-- Object names are "<user id>/<video id>.<ext>".
-- ---------------------------------------------------------------------------
create function public.queue_uploaded_video()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_video uuid;
begin
  if new.bucket_id <> 'raw-uploads' then
    return new;
  end if;
  begin
    v_user := (storage.foldername(new.name))[1]::uuid;
    v_video := split_part(storage.filename(new.name), '.', 1)::uuid;
  exception when invalid_text_representation then
    return new;
  end;
  update public.videos
     set status = 'queued', raw_path = new.name, error = null
   where id = v_video
     and user_id = v_user
     and status in ('uploading', 'failed');
  return new;
end;
$$;

create trigger raw_upload_queues_video
  after insert or update on storage.objects
  for each row execute function public.queue_uploaded_video();

-- ---------------------------------------------------------------------------
-- Batch limit. Plans can raise it later (Phase 7); 10 at launch.
-- ---------------------------------------------------------------------------
create function public.enforce_batch_limit()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.batch_id is not null
     and (select count(*) from public.videos where batch_id = new.batch_id) >= 10 then
    raise exception 'A batch can have at most 10 videos' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger videos_batch_limit
  before insert on public.videos
  for each row execute function public.enforce_batch_limit();

-- Users may only add videos to their own batches.
drop policy "videos: create own" on public.videos;
create policy "videos: create own" on public.videos
  for insert with check (
    auth.uid() = user_id
    and status = 'uploading'
    and (batch_id is null or exists (select 1 from public.batches b where b.id = batch_id and b.user_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Batch completion: the worker calls this after every video. It returns the
-- counts exactly once, when the last video in the batch finishes.
-- ---------------------------------------------------------------------------
alter table public.batches add column notified_at timestamptz;

create function public.complete_batch(p_batch_id uuid)
returns table (user_id uuid, total integer, done integer, failed integer)
language plpgsql
security definer set search_path = ''
as $$
begin
  return query
  update public.batches b
     set notified_at = now()
   where b.id = p_batch_id
     and b.notified_at is null
     and not exists (
       select 1 from public.videos v
        where v.batch_id = b.id and v.status not in ('done', 'failed')
     )
  returning
    b.user_id,
    (select count(*)::integer from public.videos v where v.batch_id = b.id),
    (select count(*)::integer from public.videos v where v.batch_id = b.id and v.status = 'done'),
    (select count(*)::integer from public.videos v where v.batch_id = b.id and v.status = 'failed');
end;
$$;

revoke execute on function public.complete_batch(uuid) from public, anon, authenticated;
grant execute on function public.complete_batch(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Expo push tokens, one row per device. Registered through a function so a
-- device that switches accounts moves its token to the new user.
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy "push_tokens: read own" on public.push_tokens
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.push_tokens from authenticated, anon;

create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

create function public.unregister_push_token(p_token text)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
