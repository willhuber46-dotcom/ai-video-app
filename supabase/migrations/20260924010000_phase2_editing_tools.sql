-- Phase 2: captions, on-screen text and zooms, plus a queue for final renders.

alter table public.videos
  add column output_width integer,
  add column output_height integer,
  -- The user's editable captions / text / zooms. Written through save_overlays().
  add column overlays jsonb,
  -- What the AI suggested for this video (text ideas, zoom moments).
  add column ai_suggestions jsonb;

-- ---------------------------------------------------------------------------
-- Saving overlays goes through a function so the app never needs broad
-- update rights on finished videos.
-- ---------------------------------------------------------------------------
create function public.save_overlays(p_video_id uuid, p_overlays jsonb)
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if pg_column_size(p_overlays) > 512 * 1024 then
    raise exception 'overlays too large';
  end if;
  update public.videos
     set overlays = p_overlays
   where id = p_video_id
     and user_id = auth.uid()
     and status = 'done';
  if not found then
    raise exception 'video not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.save_overlays(uuid, jsonb) from public, anon;
grant execute on function public.save_overlays(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Renders: each "Save to camera roll" with overlays queues one.
-- ---------------------------------------------------------------------------
create table public.renders (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Snapshot of the overlays at the time of the request.
  overlays jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  error text,
  output_path text,
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index renders_video_idx on public.renders (video_id, created_at desc);
create index renders_queue_idx on public.renders (created_at) where status = 'queued';

alter table public.renders enable row level security;

create policy "renders: read own" on public.renders
  for select using (auth.uid() = user_id);

revoke insert, update, delete on public.renders from authenticated, anon;

-- Saves the overlays and queues a render of them. Returns the render id.
create function public.request_render(p_video_id uuid, p_overlays jsonb)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  render_id uuid;
begin
  perform public.save_overlays(p_video_id, p_overlays);
  insert into public.renders (video_id, user_id, overlays)
  values (p_video_id, auth.uid(), p_overlays)
  returning id into render_id;
  return render_id;
end;
$$;

revoke execute on function public.request_render(uuid, jsonb) from public, anon;
grant execute on function public.request_render(uuid, jsonb) to authenticated;

create function public.claim_next_render()
returns setof public.renders
language plpgsql
security definer set search_path = ''
as $$
begin
  return query
  update public.renders r
     set status = 'rendering',
         locked_at = now(),
         attempts = r.attempts + 1,
         error = null
   where r.id = (
     select c.id
       from public.renders c
      where (c.status = 'queued')
         or (c.status = 'rendering' and c.locked_at < now() - interval '30 minutes' and c.attempts < 3)
      order by c.created_at
      for update skip locked
      limit 1
   )
  returning r.*;
end;
$$;

revoke execute on function public.claim_next_render() from public, anon, authenticated;
grant execute on function public.claim_next_render() to service_role;

alter table public.processing_costs drop constraint processing_costs_kind_check;
alter table public.processing_costs
  add constraint processing_costs_kind_check check (kind in ('transcription', 'ai', 'compute', 'render'));
