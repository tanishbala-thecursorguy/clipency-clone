-- =============================================================
-- CLIPATHON · 034 · trackable referral links
-- =============================================================
-- The console can already create an ambassador with a ref_code, and
-- register_creator() already resolves that code to ambassador_id or
-- referred_by on the registration row. So conversions were always
-- attributable. What was missing is the top of the funnel: nobody
-- knew how many people TAPPED a creator's link and never registered.
--
-- Two tables:
--   ref_links   one generated link, its code, who it belongs to, where
--               it lands. The console's generator writes these.
--   ref_clicks  one row per tap. Deliberately thin: no IP address, no
--               raw user agent, no cookie that follows anyone around.
--               A random browser-minted id, the OS family, whether it
--               opened inside an in-app webview, and whether the jump
--               to a real browser fired.
--
-- anon holds no grant on either table. The bridge page reaches them
-- through two SECURITY DEFINER functions and nothing else, and the
-- first of those refuses to write a row for a code that does not
-- resolve to something real, so random traffic cannot inflate the
-- table.
-- =============================================================

-- -------------------------------------------------------------
-- 1. the links
-- -------------------------------------------------------------
create table if not exists clipathon.ref_links (
  id             uuid primary key default gen_random_uuid(),
  cycle_id       uuid not null references clipathon.cycles (id) on delete cascade,

  -- The code the link carries. Matched against ambassadors.ref_code
  -- and creators.referral_code the same way register_creator does, so
  -- one code means one owner across the whole system.
  code           text not null,
  label          text not null,                      -- 'Aarav, IG bio'
  channel        text not null default 'instagram',  -- where it was posted

  -- Whichever of these the code belongs to. Both nullable because a
  -- link may be generated before the person exists as a creator.
  ambassador_id  uuid references clipathon.ambassadors (id) on delete set null,
  creator_id     uuid references clipathon.creators (id) on delete set null,

  -- Relative path only. This is what the bridge page navigates to, so
  -- anything absolute here would turn our own domain into an open
  -- redirect. The check is the enforcement, not the UI.
  dest           text not null default '/clipathon',

  is_active      boolean not null default true,
  notes          text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint ref_links_code_unique unique (cycle_id, code),
  constraint ref_links_code_shape  check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9._-]{2,23}$'),
  constraint ref_links_dest_shape  check (dest ~ '^/[A-Za-z0-9/_-]{0,60}$' and dest not like '//%'),
  constraint ref_links_channel_ok  check (channel in ('instagram','youtube','tiktok','whatsapp','x','linkedin','offline','other'))
);

create index if not exists ref_links_cycle_idx on clipathon.ref_links (cycle_id, is_active);
create index if not exists ref_links_code_idx  on clipathon.ref_links (code);

-- -------------------------------------------------------------
-- 2. the taps
-- -------------------------------------------------------------
create table if not exists clipathon.ref_clicks (
  id        bigint generated always as identity primary key,
  link_id   uuid references clipathon.ref_links (id) on delete set null,
  code      text not null,
  at        timestamptz not null default now(),

  -- A random id the browser mints and keeps in localStorage. Lets us
  -- separate 40 taps from 40 people without knowing who anybody is.
  visitor   text,

  in_app    boolean,          -- opened inside an in-app webview
  app       text,             -- 'instagram', 'facebook', 'tiktok', ...
  os        text,             -- 'ios' | 'android' | 'other'

  -- null  we never found out
  -- true  the handoff to a real browser fired
  -- false the webview refused and the person saw the fallback card
  escaped   boolean
);

create index if not exists ref_clicks_link_idx on clipathon.ref_clicks (link_id, at desc);
create index if not exists ref_clicks_code_idx on clipathon.ref_clicks (code, at desc);
create index if not exists ref_clicks_visitor_idx on clipathon.ref_clicks (code, visitor);

-- -------------------------------------------------------------
-- 3. RLS. Console reads and writes, nobody else touches either table.
-- -------------------------------------------------------------
alter table clipathon.ref_links  enable row level security;
alter table clipathon.ref_clicks enable row level security;

drop policy if exists ref_links_read on clipathon.ref_links;
create policy ref_links_read on clipathon.ref_links
  for select to authenticated
  using (clipathon.is_admin() or creator_id = clipathon.my_creator_id());

drop policy if exists ref_links_write on clipathon.ref_links;
create policy ref_links_write on clipathon.ref_links
  for all to authenticated
  using (clipathon.has_role(array['marketing','ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['marketing','ops']::clipathon.admin_role[]));

-- Clicks are written by the definer function below and by nothing else,
-- so there is no insert policy at all. Read is admin only.
drop policy if exists ref_clicks_read on clipathon.ref_clicks;
create policy ref_clicks_read on clipathon.ref_clicks
  for select to authenticated using (clipathon.is_admin());

-- -------------------------------------------------------------
-- 4. the write path the bridge page uses
-- -------------------------------------------------------------
-- Returns the landing path for the code and records the tap. Refuses
-- to record anything for a code that resolves to nobody, which is what
-- keeps this table from filling with noise.
create or replace function clipathon.track_ref_click(
  p_code    text,
  p_visitor text    default null,
  p_in_app  boolean default null,
  p_app     text    default null,
  p_os      text    default null
) returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  v_code   text := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_cycle  uuid;
  v_link   clipathon.ref_links%rowtype;
  v_dest   text := '/clipathon';
  v_known  boolean := false;
  v_recent integer;
  v_id     bigint;
begin
  -- Shape first. A code that cannot exist is not worth a lookup.
  if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9._-]{2,23}$' then
    return jsonb_build_object('ok', true, 'known', false, 'dest', v_dest);
  end if;

  -- The cycle people are actually being sent to: the one still to
  -- finish, falling back to the most recent.
  select id into v_cycle from clipathon.cycles
   where status <> 'draft' and (finale_at is null or finale_at > now())
   order by registration_closes asc limit 1;
  if v_cycle is null then
    select id into v_cycle from clipathon.cycles
     where status <> 'draft' order by registration_closes desc limit 1;
  end if;

  select * into v_link from clipathon.ref_links
   where code = v_code and is_active
     and (cycle_id = v_cycle or v_cycle is null)
   order by created_at desc limit 1;

  if v_link.id is not null then
    v_known := true;
    v_dest  := v_link.dest;
  else
    -- No generated link, but the code may still be a live ambassador
    -- code or a creator's own referral code. Those are real referrals
    -- and worth counting.
    v_known := exists (
      select 1 from clipathon.ambassadors
       where upper(ref_code) = v_code and is_active
         and (cycle_id = v_cycle or v_cycle is null))
      or exists (
      select 1 from clipathon.creators where upper(referral_code) = v_code);
  end if;

  if not v_known then
    return jsonb_build_object('ok', true, 'known', false, 'dest', '/clipathon');
  end if;

  -- Double-fired taps are the common case, not abuse: a webview that
  -- reloads the bridge, or a person pressing back. Collapse anything
  -- from the same visitor on the same code inside ten seconds.
  if p_visitor is not null then
    select count(*) into v_recent from clipathon.ref_clicks
     where code = v_code and visitor = p_visitor and at > now() - interval '10 seconds';
    if v_recent > 0 then
      return jsonb_build_object('ok', true, 'known', true, 'dest', v_dest, 'code', v_code);
    end if;
  end if;

  insert into clipathon.ref_clicks (link_id, code, visitor, in_app, app, os)
  values (v_link.id, v_code, left(nullif(btrim(coalesce(p_visitor,'')),''), 40),
          p_in_app,
          left(nullif(btrim(coalesce(p_app,'')),''), 24),
          case lower(coalesce(p_os,'')) when 'ios' then 'ios' when 'android' then 'android' else 'other' end)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'known', true, 'dest', v_dest,
                            'code', v_code, 'click_id', v_id);
end;
$$;

-- Called only when we know the jump did not happen, so the console can
-- tell "Instagram let them out" from "Instagram kept them in". Narrow
-- on purpose: one column, one row, recent rows only.
create or replace function clipathon.mark_ref_click_escaped(
  p_click_id bigint,
  p_escaped  boolean
) returns void
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  if p_click_id is null or p_escaped is null then return; end if;
  update clipathon.ref_clicks
     set escaped = p_escaped
   where id = p_click_id
     and escaped is null
     and at > now() - interval '10 minutes';
end;
$$;

-- -------------------------------------------------------------
-- 5. what the console reads
-- -------------------------------------------------------------
-- security_invoker so the reader's own RLS decides, which means this
-- returns nothing at all to a creator who is not an operator.
create or replace view clipathon.v_ref_link_stats
with (security_invoker = on) as
select
  l.id            as link_id,
  l.cycle_id,
  l.code,
  l.label,
  l.channel,
  l.dest,
  l.is_active,
  l.notes,
  l.ambassador_id,
  l.creator_id,
  l.created_at,
  coalesce(c.clicks, 0)    as clicks,
  coalesce(c.visitors, 0)  as visitors,
  coalesce(c.escaped, 0)   as escaped,
  coalesce(c.trapped, 0)   as trapped,
  coalesce(r.registrations, 0) as registrations,
  coalesce(r.approved, 0)  as approved,
  c.last_click_at
from clipathon.ref_links l
left join lateral (
  select count(*)                                        as clicks,
         count(distinct k.visitor)                       as visitors,
         count(*) filter (where k.escaped is true)       as escaped,
         count(*) filter (where k.escaped is false)      as trapped,
         max(k.at)                                       as last_click_at
    from clipathon.ref_clicks k
   where k.code = l.code
) c on true
left join lateral (
  select count(*)                                                                as registrations,
         count(*) filter (where g.status = 'approved')                            as approved
    from clipathon.registrations g
   where g.cycle_id = l.cycle_id and upper(coalesce(g.ref_code_used, '')) = l.code
) r on true;

-- -------------------------------------------------------------
-- 6. grants. The lock from 013 is still in force, so every new
--    function starts unreachable and has to be handed out by name.
-- -------------------------------------------------------------
grant execute on function clipathon.track_ref_click(text, text, boolean, text, text)
  to anon, authenticated;
grant execute on function clipathon.mark_ref_click_escaped(bigint, boolean)
  to anon, authenticated;
