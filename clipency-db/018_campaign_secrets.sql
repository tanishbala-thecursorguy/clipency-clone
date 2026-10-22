-- 018 · Take client rates and client PINs out of the readable campaigns table.
--
-- The hole. campaigns is readable by everyone - the camp_read policy has no
-- role, so even a visitor with no login can read every public campaign using
-- the anon key the site ships - and three of its columns are not for them:
--   client_rate_per_video / client_rpm  what the brand is billed. With the
--                                        creator rate beside it, that is the
--                                        agency margin, read by any creator.
--   client_pin                          the 4-digit key to client_campaign_report,
--                                        which returns the campaign's figures,
--                                        including creator earnings.
-- RLS filters rows, never columns, so no policy can fix this in place.
--
-- The fix, chosen because it is safe in either deploy order:
--   * the three values move to campaign_secrets, which nobody but staff
--     functions can read. The columns stay on campaigns (so every existing
--     select *, and the console as currently deployed, keep working) but are
--     always 0 / null there.
--   * writes still land: a trigger per column catches a value written to
--     campaigns, files it in campaign_secrets and blanks it on the row. So the
--     console needs no change to SAVE a brand rate. It does need one to READ
--     it back (admin_campaign_secrets()), which is in console.html.
--   * the helpers that price the client side (campaign_rate_ratio and the
--     functions built on it) read campaign_secrets, run as definer, and are no
--     longer callable from the API: with the secret out of the row, calling
--     campaign_rate_ratio(row) would have been a new way to ask for it.
--   * campaigns_client_rate_chk (brand rate >= creator rate) cannot see the
--     secrets table, so the same rule is enforced by a trigger.
--   * client_campaign_report (the PIN report) is switched off for API callers.
--     It was used 3 times, last on 28 Aug; its rate limit trusted an ip_hash
--     the caller supplies; a PIN is 4 digits; and it returned creator
--     earnings to a client. Clients sign in to the portal instead. PINs are
--     kept, staff-readable, if it is ever wanted back.
--
-- Money: nothing is repriced. Every client figure and every creator figure
-- is computed from the same numbers as before; they are just read from
-- campaign_secrets now.

-- 1. the table ---------------------------------------------------------------
create table if not exists public.campaign_secrets (
  campaign_id            uuid primary key
                         references public.campaigns(id) on delete cascade
                         deferrable initially deferred,
  client_rate_per_video  numeric not null default 0 check (client_rate_per_video >= 0),
  client_rpm             numeric not null default 0 check (client_rpm >= 0),
  client_pin             text unique,
  updated_at             timestamptz not null default now()
);
comment on table public.campaign_secrets is
  'Per-campaign values the creator network must never see: what the brand is billed (client_rate_per_video, client_rpm) and the client report PIN. Written through triggers on campaigns; read only by SECURITY DEFINER functions and admin_campaign_secrets().';

alter table public.campaign_secrets enable row level security;
revoke all on public.campaign_secrets from public, anon, authenticated;

-- 2. move what is there, then blank the public columns -----------------------
insert into public.campaign_secrets (campaign_id, client_rate_per_video, client_rpm, client_pin)
select id, coalesce(client_rate_per_video, 0), coalesce(client_rpm, 0), client_pin
from public.campaigns
on conflict (campaign_id) do update
  set client_rate_per_video = excluded.client_rate_per_video,
      client_rpm            = excluded.client_rpm,
      client_pin            = coalesce(excluded.client_pin, public.campaign_secrets.client_pin);

alter table public.campaigns disable trigger trg_touch_campaign_updated_at;
update public.campaigns
   set client_rate_per_video = 0, client_rpm = 0, client_pin = null
 where coalesce(client_rate_per_video, 0) <> 0 or coalesce(client_rpm, 0) <> 0 or client_pin is not null;
alter table public.campaigns enable trigger trg_touch_campaign_updated_at;

-- 3. writes: file the value, blank the row -----------------------------------
create or replace function public.cx_campaign_secret_capture()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare col text := tg_argv[0];
begin
  insert into public.campaign_secrets (campaign_id) values (new.id)
  on conflict (campaign_id) do nothing;

  if col in ('all', 'client_rate_per_video') then
    if tg_op = 'UPDATE' or coalesce(new.client_rate_per_video, 0) <> 0 then
      update public.campaign_secrets
         set client_rate_per_video = greatest(coalesce(new.client_rate_per_video, 0), 0),
             updated_at = now()
       where campaign_id = new.id;
    end if;
    new.client_rate_per_video := 0;
  end if;

  if col in ('all', 'client_rpm') then
    if tg_op = 'UPDATE' or coalesce(new.client_rpm, 0) <> 0 then
      update public.campaign_secrets
         set client_rpm = greatest(coalesce(new.client_rpm, 0), 0), updated_at = now()
       where campaign_id = new.id;
    end if;
    new.client_rpm := 0;
  end if;

  if col in ('all', 'client_pin') then
    if new.client_pin is not null then
      update public.campaign_secrets set client_pin = new.client_pin, updated_at = now()
       where campaign_id = new.id;
    end if;
    new.client_pin := null;
  end if;

  return new;
end $$;
revoke execute on function public.cx_campaign_secret_capture() from public, anon, authenticated;

-- "zz" so these run after assign_client_pin (which generates the PIN) and
-- after the currency trigger. BEFORE UPDATE OF <col> fires whenever the column
-- is in the SET list, so writing 0 to clear a brand rate still clears it,
-- while an update that does not mention the column leaves it alone.
drop trigger if exists zz_cx_secret_ins  on public.campaigns;
drop trigger if exists zz_cx_secret_crpv on public.campaigns;
drop trigger if exists zz_cx_secret_crpm on public.campaigns;
drop trigger if exists zz_cx_secret_pin  on public.campaigns;
create trigger zz_cx_secret_ins  before insert on public.campaigns
  for each row execute function public.cx_campaign_secret_capture('all');
create trigger zz_cx_secret_crpv before update of client_rate_per_video on public.campaigns
  for each row execute function public.cx_campaign_secret_capture('client_rate_per_video');
create trigger zz_cx_secret_crpm before update of client_rpm on public.campaigns
  for each row execute function public.cx_campaign_secret_capture('client_rpm');
create trigger zz_cx_secret_pin  before update of client_pin on public.campaigns
  for each row execute function public.cx_campaign_secret_capture('client_pin');

-- PIN generation checks the secrets table for collisions now.
create or replace function public.cx_generate_client_pin()
returns character
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p char(4);
begin
  loop
    p := lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    exit when not exists (select 1 from public.campaign_secrets where client_pin = p);
  end loop;
  return p;
end $$;
revoke execute on function public.cx_generate_client_pin() from public, anon, authenticated;

-- The PIN trigger runs as the inserting admin; the generator it calls is no
-- longer callable from the API, so the trigger runs as definer.
create or replace function public.trg_assign_client_pin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.client_pin is null then
    new.client_pin := public.cx_generate_client_pin();
  end if;
  return new;
end $$;
revoke execute on function public.trg_assign_client_pin() from public, anon, authenticated;

-- 4. brand rate >= creator rate, now that the check constraint cannot see it -
create or replace function public.cx_campaign_client_rate_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare s public.campaign_secrets%rowtype;
begin
  select * into s from public.campaign_secrets where campaign_id = new.id;
  if not found then return null; end if;
  if s.client_rate_per_video > 0 and s.client_rate_per_video < coalesce(new.rate_per_video, 0) then
    raise exception 'The brand rate (%) is below the creator rate (%): the agency would be paying to work.',
      s.client_rate_per_video, new.rate_per_video using errcode = '23514';
  end if;
  if s.client_rpm > 0 and s.client_rpm < coalesce(new.rpm, 0) then
    raise exception 'The brand rate per 1M (%) is below the creator rate per 1M (%).',
      s.client_rpm, new.rpm using errcode = '23514';
  end if;
  return null;
end $$;
revoke execute on function public.cx_campaign_client_rate_check() from public, anon, authenticated;

drop trigger if exists cx_campaign_client_rate_chk on public.campaigns;
create constraint trigger cx_campaign_client_rate_chk
  after insert or update of rate_per_video, rpm, client_rate_per_video, client_rpm on public.campaigns
  deferrable initially immediate
  for each row execute function public.cx_campaign_client_rate_check();

-- 5. the pricing helpers read the secrets table ------------------------------
create or replace function public.campaign_rate_ratio(c public.campaigns)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when coalesce(c.payout_model,'per_view') = 'per_video' then
      case when coalesce(s.client_rate_per_video,0) > 0 and coalesce(c.rate_per_video,0) > 0
           then least(c.rate_per_video / s.client_rate_per_video, 1)
           else 1 end
    else
      case when coalesce(s.client_rpm,0) > 0 and coalesce(c.rpm,0) > 0
           then least(c.rpm / s.client_rpm, 1)
           else 1 end
  end
  from (select 1) one
  left join public.campaign_secrets s on s.campaign_id = c.id;
$$;

create or replace function public.campaign_client_unit_rate(c public.campaigns)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(s.client_rate_per_video, 0), c.rate_per_video, 0)
  from (select 1) one
  left join public.campaign_secrets s on s.campaign_id = c.id;
$$;

-- per 1M views, brand side
create or replace function public.campaign_client_unit_rpm(c public.campaigns)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(s.client_rpm, 0), c.rpm, 0)
  from (select 1) one
  left join public.campaign_secrets s on s.campaign_id = c.id;
$$;

-- The pool and the margin are built on the ratio, so they now read the
-- secret through it: same bodies, STABLE instead of IMMUTABLE.
create or replace function public.campaign_creator_pool(c public.campaigns)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(round(
    (case when c.fee_mode = 'on_top'
          then coalesce(c.budget,0)
          else coalesce(c.budget,0) - public.campaign_fee(c)
     end) * public.campaign_rate_ratio(c)
  , 2), 0);
$$;

create or replace function public.campaign_agency_margin(c public.campaigns)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(round(
    (case when c.fee_mode = 'on_top'
          then coalesce(c.budget,0)
          else coalesce(c.budget,0) - public.campaign_fee(c)
     end) - public.campaign_creator_pool(c)
  , 2), 0);
$$;

-- Callable only from inside the database. Every caller is a SECURITY
-- DEFINER function, so none of them loses access.
revoke execute on function public.campaign_rate_ratio(public.campaigns)       from public, anon, authenticated;
revoke execute on function public.campaign_client_unit_rate(public.campaigns) from public, anon, authenticated;
revoke execute on function public.campaign_client_unit_rpm(public.campaigns)  from public, anon, authenticated;
revoke execute on function public.campaign_creator_pool(public.campaigns)     from public, anon, authenticated;
revoke execute on function public.campaign_agency_margin(public.campaigns)    from public, anon, authenticated;

-- 6. staff read-back for the console -----------------------------------------
create or replace function public.admin_campaign_secrets()
returns table (campaign_id uuid, client_rate_per_video numeric, client_rpm numeric, client_pin text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select s.campaign_id, s.client_rate_per_video, s.client_rpm, s.client_pin
    from public.campaign_secrets s;
end $$;
revoke execute on function public.admin_campaign_secrets() from public, anon;
grant execute on function public.admin_campaign_secrets() to authenticated;

-- 7. the PIN report: off for API callers --------------------------------------
revoke execute on function public.client_campaign_report(text, text) from public, anon, authenticated;

-- 8. the three readers that named the columns directly ------------------------
do $mig$
declare d text; n text;
begin
  -- client_dashboard_data: the brand rate per 1M came from c.client_rpm
  d := pg_get_functiondef('public.client_dashboard_data()'::regprocedure);
  n := replace(d, $x$case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end$x$, 'public.campaign_client_unit_rpm(c)');
  if n = d or position('client_rpm,0)' in n) > 0 then
    raise exception 'client_dashboard_data: client_rpm reference not replaced';
  end if;
  execute n;

  -- client_campaign_report: finds the campaign by PIN
  d := pg_get_functiondef('public.client_campaign_report(text,text)'::regprocedure);
  n := replace(d, 'SELECT * INTO v_campaign FROM campaigns WHERE client_pin = p_pin;',
    'SELECT * INTO v_campaign FROM campaigns WHERE id = (SELECT s.campaign_id FROM campaign_secrets s WHERE s.client_pin = p_pin);');
  if n = d then raise exception 'client_campaign_report: PIN lookup not replaced'; end if;
  execute n;
end $mig$;
revoke execute on function public.client_campaign_report(text, text) from public, anon, authenticated;

-- v_cx_client_campaign_spend runs as the caller (security_invoker), who
-- cannot read campaign_secrets, so it gets the price through a function that
-- answers only for the campaign's own clients and staff. It also priced with
-- coalesce(client_rate_per_video, rate_per_video), which returned 0 for a
-- campaign with no brand rate (0 is not null); now it is the same rule as
-- campaign_client_unit_rate(): the brand rate, else the creator rate.
create or replace function public.cx_campaign_client_price(p_campaign uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.cx_is_staff()
                or c.client_user_id = auth.uid()
                or public.cx_is_campaign_client(c.id)
              then public.campaign_client_unit_rate(c) end
  from public.campaigns c where c.id = p_campaign;
$$;
revoke execute on function public.cx_campaign_client_price(uuid) from public, anon;
grant execute on function public.cx_campaign_client_price(uuid) to authenticated;

do $mig$
declare d text; n text;
begin
  d := pg_get_viewdef('public.v_cx_client_campaign_spend'::regclass, true);
  n := replace(d, 'COALESCE(c.client_rate_per_video, c.rate_per_video, 0::numeric)',
                  'COALESCE(cx_campaign_client_price(c.id), 0::numeric)');
  n := replace(n, 'c.client_rate_per_video, c.rate_per_video;', 'c.rate_per_video;');
  if n = d or position('c.client_rate_per_video' in n) > 0 then
    raise exception 'v_cx_client_campaign_spend: not fully rewritten: %', n;
  end if;
  execute 'create or replace view public.v_cx_client_campaign_spend with (security_invoker = true) as ' || n;
end $mig$;
