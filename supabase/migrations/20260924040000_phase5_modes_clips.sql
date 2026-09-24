-- Phase 5: Multiple Clips (several inputs combined into one video) and a
-- separate voice recording for Voiceover Mode.

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Order the clips were added in; the edit keeps it.
  position integer not null,
  kind text not null default 'clip' check (kind in ('clip', 'voice')),
  duration_s numeric,
  raw_path text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (video_id, kind, position)
);

create index clips_video_idx on public.clips (video_id, position);

alter table public.clips enable row level security;

create policy "clips: read own" on public.clips
  for select using (auth.uid() = user_id);

-- Clips can only be added to the user's own video while it is uploading.
create policy "clips: create own" on public.clips
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid() and v.status = 'uploading')
  );

revoke insert, update, delete on public.clips from authenticated, anon;
grant insert (video_id, position, kind, duration_s) on public.clips to authenticated;

create function public.enforce_clip_limit()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_limit integer := case when new.kind = 'voice' then 1 else 10 end;
begin
  if (select count(*) from public.clips where video_id = new.video_id and kind = new.kind) >= v_limit then
    raise exception 'Too many % files for one video', new.kind using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger clips_limit
  before insert on public.clips
  for each row execute function public.enforce_clip_limit();

-- ---------------------------------------------------------------------------
-- Queue on upload, now aware of clips. Clip files are "<user id>/<clip id>.<ext>";
-- the video is queued once every one of its clips has landed.
-- ---------------------------------------------------------------------------
create or replace function public.queue_uploaded_video()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_id uuid;
  v_video uuid;
begin
  if new.bucket_id <> 'raw-uploads' then
    return new;
  end if;
  begin
    v_user := (storage.foldername(new.name))[1]::uuid;
    v_id := split_part(storage.filename(new.name), '.', 1)::uuid;
  exception when invalid_text_representation then
    return new;
  end;

  update public.clips c
     set raw_path = new.name, uploaded_at = now()
   where c.id = v_id and c.user_id = v_user
  returning c.video_id into v_video;

  if v_video is null then
    -- A single-clip video uploaded under its own id.
    v_video := v_id;
    update public.videos
       set status = 'queued', raw_path = new.name, error = null
     where id = v_video and user_id = v_user and status in ('uploading', 'failed');
    return new;
  end if;

  update public.videos v
     set status = 'queued', error = null
   where v.id = v_video
     and v.user_id = v_user
     and v.status in ('uploading', 'failed')
     and not exists (select 1 from public.clips c where c.video_id = v.id and c.uploaded_at is null);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retry: re-queue a failed video whose files are all on the server.
-- Returns false when something still needs uploading from the phone.
-- ---------------------------------------------------------------------------
create function public.retry_video(p_video_id uuid)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  update public.videos v
     set status = 'queued', error = null
   where v.id = p_video_id
     and v.user_id = auth.uid()
     and v.status in ('uploading', 'failed')
     and (
       case
         when exists (select 1 from public.clips c where c.video_id = v.id)
           then not exists (select 1 from public.clips c where c.video_id = v.id and c.uploaded_at is null)
         else v.raw_path is not null
       end
     );
  return found;
end;
$$;

revoke execute on function public.retry_video(uuid) from public, anon;
grant execute on function public.retry_video(uuid) to authenticated;
