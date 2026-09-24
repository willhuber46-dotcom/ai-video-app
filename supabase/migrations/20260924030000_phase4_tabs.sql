-- Phase 4: Cuts tab, Profile and Settings, 30-day auto-delete, account deletion.

-- ---------------------------------------------------------------------------
-- Profile: plan (payments arrive in Phase 7) and a lifetime cut counter that
-- survives cuts being deleted.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column plan text not null default 'free',
  add column cuts_made integer not null default 0;

-- Users edit their name and language; plan and counters are server-owned.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, record_language) on public.profiles to authenticated;

create function public.count_finished_cut()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    update public.profiles set cuts_made = cuts_made + 1 where id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger videos_count_finished_cut
  after update of status on public.videos
  for each row execute function public.count_finished_cut();

-- ---------------------------------------------------------------------------
-- Deleting cuts from the app: users may remove their own files in "cuts".
-- ---------------------------------------------------------------------------
create policy "cuts: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cuts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 30-day auto-delete: a warning push 3 days before, then deletion.
-- ---------------------------------------------------------------------------
alter table public.videos add column expiry_warned_at timestamptz;

create index videos_expires_idx on public.videos (expires_at) where status = 'done';

-- Marks cuts that expire within 3 days as warned; returns one row per user to notify.
create function public.claim_expiry_warnings()
returns table (user_id uuid, cuts integer, first_expires_at timestamptz)
language sql
security definer set search_path = ''
as $$
  with warned as (
    update public.videos v
       set expiry_warned_at = now()
     where v.status = 'done'
       and v.expiry_warned_at is null
       and v.expires_at > now()
       and v.expires_at <= now() + interval '3 days'
    returning v.user_id, v.expires_at
  )
  select w.user_id, count(*)::integer, min(w.expires_at) from warned w group by w.user_id;
$$;

revoke execute on function public.claim_expiry_warnings() from public, anon, authenticated;
grant execute on function public.claim_expiry_warnings() to service_role;

-- ---------------------------------------------------------------------------
-- A lease so only one worker runs the periodic maintenance at a time.
-- ---------------------------------------------------------------------------
create table public.worker_leases (
  name text primary key,
  leased_until timestamptz not null
);

alter table public.worker_leases enable row level security;

create function public.acquire_lease(p_name text, p_seconds integer)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.worker_leases (name, leased_until)
  values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set leased_until = excluded.leased_until
    where public.worker_leases.leased_until < now();
  return found;
end;
$$;

revoke execute on function public.acquire_lease(text, integer) from public, anon, authenticated;
grant execute on function public.acquire_lease(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Account deletion (required by Apple for apps with accounts). The app files
-- a request; the worker deletes the user's files and then the auth user,
-- which cascades to every table.
-- ---------------------------------------------------------------------------
create table public.account_deletions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table public.account_deletions enable row level security;

create function public.request_account_deletion()
returns void
language plpgsql
security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  insert into public.account_deletions (user_id) values (auth.uid()) on conflict do nothing;
  -- Stop anything still in flight for this account.
  delete from public.push_tokens where user_id = auth.uid();
end;
$$;

revoke execute on function public.request_account_deletion() from public, anon;
grant execute on function public.request_account_deletion() to authenticated;
