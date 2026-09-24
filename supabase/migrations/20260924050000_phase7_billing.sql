-- Phase 7: plans, credits and Stripe billing.
-- One credit = one finished video (up to 10 minutes of input). Credits are
-- only used when a video comes out "done"; starting a batch just checks that
-- enough are available.

-- ---------------------------------------------------------------------------
-- Plans and credit packs. The app reads these, so prices and allowances can
-- change without an app update. Stripe price ids are filled in by
-- `npm run billing:setup -w worker`.
-- ---------------------------------------------------------------------------
create table public.plans (
  key text primary key,
  label text not null,
  monthly_credits integer not null,
  batch_limit integer not null,
  price_cents integer not null default 0,
  stripe_price_id text,
  sort integer not null default 0
);

create table public.credit_packs (
  key text primary key,
  label text not null,
  credits integer not null,
  price_cents integer not null,
  stripe_price_id text,
  sort integer not null default 0
);

insert into public.plans (key, label, monthly_credits, batch_limit, price_cents, sort) values
  ('free', 'Free', 10, 10, 0, 0),
  ('creator', 'Creator', 100, 10, 1999, 1),
  ('pro', 'Pro', 300, 20, 4999, 2);

insert into public.credit_packs (key, label, credits, price_cents, sort) values
  ('pack_25', '25 credits', 25, 799, 0),
  ('pack_100', '100 credits', 100, 2499, 1);

alter table public.plans enable row level security;
alter table public.credit_packs enable row level security;
create policy "plans: readable" on public.plans for select to authenticated using (true);
create policy "credit_packs: readable" on public.credit_packs for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Balances live on the profile (server-owned columns; users can't write them).
-- Plan credits reset every period; pack credits never expire.
-- ---------------------------------------------------------------------------
update public.profiles set plan = 'free' where plan not in (select key from public.plans);

alter table public.profiles
  add constraint profiles_plan_fk foreign key (plan) references public.plans (key),
  add column plan_credits integer not null default 10,
  add column pack_credits integer not null default 0,
  add column plan_period_end timestamptz not null default now() + interval '1 month',
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text;

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null check (reason in ('plan_grant', 'pack_grant', 'spend', 'adjust')),
  -- Stripe invoice/session id or video id: makes every grant and spend idempotent.
  ref text unique,
  created_at timestamptz not null default now()
);

create index credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
create policy "credit_ledger: read own" on public.credit_ledger for select using (auth.uid() = user_id);

-- Free plans top back up each month, lazily, whenever credits are looked at.
create function public.refresh_credits(p_user uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  v_allowance integer;
begin
  select pl.monthly_credits into v_allowance
    from public.profiles p join public.plans pl on pl.key = p.plan
   where p.id = p_user and p.plan = 'free' and p.plan_period_end <= now()
   for update of p;
  if v_allowance is null then
    return;
  end if;
  update public.profiles
     set plan_credits = v_allowance,
         -- Step forward whole months so the reset day stays the same.
         plan_period_end = plan_period_end
           + make_interval(months => 1 + floor(extract(epoch from now() - plan_period_end) / 2629746)::integer)
   where id = p_user;
end;
$$;

-- Videos started but not finished yet: they will each need a credit.
create function public.credits_in_flight(p_user uuid)
returns integer
language sql
stable
security definer set search_path = ''
as $$
  select count(*)::integer from public.videos
   where user_id = p_user and status in ('uploading', 'queued', 'editing');
$$;

create function public.get_my_credits()
returns table (
  plan text,
  plan_label text,
  monthly_credits integer,
  batch_limit integer,
  plan_credits integer,
  pack_credits integer,
  in_flight integer,
  available integer,
  period_end timestamptz,
  has_subscription boolean
)
language plpgsql
security definer set search_path = ''
as $$
begin
  perform public.refresh_credits(auth.uid());
  return query
  select p.plan, pl.label, pl.monthly_credits, pl.batch_limit, p.plan_credits, p.pack_credits,
         public.credits_in_flight(p.id),
         greatest(0, p.plan_credits + p.pack_credits - public.credits_in_flight(p.id)),
         p.plan_period_end, p.stripe_subscription_id is not null
    from public.profiles p join public.plans pl on pl.key = p.plan
   where p.id = auth.uid();
end;
$$;

revoke execute on function public.refresh_credits(uuid) from public, anon, authenticated;
revoke execute on function public.credits_in_flight(uuid) from public, anon, authenticated;
revoke execute on function public.get_my_credits() from public, anon;
grant execute on function public.get_my_credits() to authenticated;

-- Starting a video needs a free credit (counting ones already in flight).
create function public.check_credit_available()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_balance integer;
begin
  perform public.refresh_credits(new.user_id);
  select plan_credits + pack_credits into v_balance from public.profiles where id = new.user_id;
  if coalesce(v_balance, 0) - public.credits_in_flight(new.user_id) < 1 then
    raise exception 'insufficient_credits' using errcode = 'P0001', hint = 'Upgrade your plan or buy credits.';
  end if;
  return new;
end;
$$;

create trigger videos_check_credit
  before insert on public.videos
  for each row execute function public.check_credit_available();

-- A finished video uses one credit: this period's plan credits first, then packs.
create function public.spend_credit_on_done()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    insert into public.credit_ledger (user_id, delta, reason, ref)
    values (new.user_id, -1, 'spend', 'video:' || new.id)
    on conflict (ref) do nothing;
    if found then
      update public.profiles
         set plan_credits = case when plan_credits > 0 then plan_credits - 1 else plan_credits end,
             pack_credits = case when plan_credits > 0 then pack_credits else greatest(0, pack_credits - 1) end
       where id = new.user_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger videos_spend_credit
  after update of status on public.videos
  for each row execute function public.spend_credit_on_done();

-- Batch size follows the plan (10 at launch, 20 on Pro).
create or replace function public.enforce_batch_limit()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  v_limit integer;
begin
  select pl.batch_limit into v_limit
    from public.profiles p join public.plans pl on pl.key = p.plan
   where p.id = new.user_id;
  if new.batch_id is not null
     and (select count(*) from public.videos where batch_id = new.batch_id) >= coalesce(v_limit, 10) then
    raise exception 'A batch can have at most % videos on your plan', coalesce(v_limit, 10) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Called by the billing server (service role) when Stripe says so. Every call
-- carries a Stripe id as `p_ref`, so webhook retries never double-grant.
-- ---------------------------------------------------------------------------

-- A paid (or renewed) subscription period: switch plan and reset its credits.
create function public.grant_plan(p_user uuid, p_plan text, p_period_end timestamptz, p_ref text, p_subscription text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
declare
  v_allowance integer;
begin
  select monthly_credits into v_allowance from public.plans where key = p_plan;
  if v_allowance is null then
    raise exception 'unknown plan %', p_plan;
  end if;
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user, v_allowance, 'plan_grant', p_ref)
  on conflict (ref) do nothing;
  if not found then
    return false;
  end if;
  update public.profiles
     set plan = p_plan, plan_credits = v_allowance, plan_period_end = p_period_end,
         stripe_subscription_id = p_subscription
   where id = p_user;
  return true;
end;
$$;

create function public.grant_pack(p_user uuid, p_credits integer, p_ref text)
returns boolean
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.credit_ledger (user_id, delta, reason, ref)
  values (p_user, p_credits, 'pack_grant', p_ref)
  on conflict (ref) do nothing;
  if not found then
    return false;
  end if;
  update public.profiles set pack_credits = pack_credits + p_credits where id = p_user;
  return true;
end;
$$;

-- Subscription ended: back to Free. Credits left this period are kept until it
-- ends; after that the monthly Free top-up applies.
create function public.end_subscription(p_user uuid)
returns void
language sql
security definer set search_path = ''
as $$
  update public.profiles
     set plan = 'free',
         stripe_subscription_id = null,
         plan_credits = least(plan_credits, (select monthly_credits from public.plans where key = 'free'))
   where id = p_user;
$$;

revoke execute on function public.grant_plan(uuid, text, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.grant_pack(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.end_subscription(uuid) from public, anon, authenticated;
grant execute on function public.grant_plan(uuid, text, timestamptz, text, text) to service_role;
grant execute on function public.grant_pack(uuid, integer, text) to service_role;
grant execute on function public.end_subscription(uuid) to service_role;

-- The app removes a half-created batch if starting it fails (e.g. out of credits).
create policy "batches: delete own" on public.batches for delete using (auth.uid() = user_id);
