-- =============================================================
-- CLIPATHON · 014 · the auth layer
-- =============================================================
-- Clipathon has an unusual order of events. A creator registers with a
-- form BEFORE they have any login, gets reviewed by a human, and only
-- then needs a dashboard. So there are two identities to reconcile:
--
--   clipathon.creators  - the person, created by the signup form
--   auth.users          - the login, created later on the sign in page
--
-- 012 added link_auth_user() to join them by verified email. This file
-- adds what the login page and the dashboard actually need on top:
-- one bootstrap call that answers "who is this and where do they go",
-- and a record of who has genuinely logged in.
--
-- Deliberately NOT here: a trigger on auth.users. That table is shared
-- with the clipping product, so a trigger firing on every signup could
-- take clipper registration down with it. Linking stays an explicit
-- call that can only affect Clipathon.
-- =============================================================

-- -------------------------------------------------------------
-- login_events
-- -------------------------------------------------------------
-- Ops question this answers: of 500 approved creators, how many have
-- actually opened the dashboard? Without it, "approved" and "ready"
-- look identical right up to the moment slot selection opens.
create table clipathon.login_events (
  id          uuid primary key default gen_random_uuid(),
  creator_id  uuid references clipathon.creators (id) on delete cascade,
  auth_user_id uuid,
  email       citext,
  kind        text not null default 'signin',   -- 'signin' | 'link' | 'first_login'
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index login_events_creator_idx on clipathon.login_events (creator_id, created_at desc);
create index login_events_time_idx    on clipathon.login_events (created_at desc);

alter table clipathon.login_events enable row level security;

create policy login_events_read_self on clipathon.login_events
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());

-- Written by me() below, running as definer. No client insert policy.

-- -------------------------------------------------------------
-- me()
-- -------------------------------------------------------------
-- One call, everything the login page and the dashboard need to decide
-- what to show. Called immediately after sign in.
--
-- It links the auth user to the creator on the way through, so a
-- creator who signs in for the first time is joined up without the
-- client having to remember a second call.
--
-- The shape is deliberately flat and boolean-heavy: the page should
-- never have to infer "can this person select a slot" by assembling
-- three queries and getting the rule slightly wrong.
create or replace function clipathon.me(p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  -- text, not citext: the pinned search_path excludes public, where the
  -- citext extension lives, so declaring the variable as citext fails to
  -- compile. Comparing text against the citext email column still does a
  -- case-insensitive match, which is the behaviour we wanted anyway.
  v_email  text;
  c        record;
  reg      record;
  cy       record;
  v_first  boolean := false;
  v_accts  jsonb;
  v_verified boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into c from clipathon.creators where auth_user_id = v_uid;

  -- Not linked yet. Match on the verified JWT email, never on anything
  -- the client passes in.
  if c.id is null and v_email is not null then
    select * into c from clipathon.creators where email = v_email;

    if c.id is not null then
      if c.auth_user_id is not null and c.auth_user_id <> v_uid then
        return jsonb_build_object('ok', false, 'error', 'already_linked',
          'message', 'That registration is already linked to a different login.');
      end if;
      update clipathon.creators
         set auth_user_id      = v_uid,
             email_verified_at = coalesce(email_verified_at, now())
       where id = c.id;
      v_first := true;
    end if;
  end if;

  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered',
      'email', v_email,
      'message', 'No Clipathon registration found for that email.');
  end if;

  if c.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'blocked',
      'message', 'This account cannot access the dashboard.');
  end if;

  -- Their entry in the newest cycle they are actually in.
  select r.* into reg
    from clipathon.registrations r
    join clipathon.cycles k on k.id = r.cycle_id
   where r.creator_id = c.id
   order by k.registration_closes desc
   limit 1;

  if reg.id is not null then
    select * into cy from clipathon.cycles where id = reg.cycle_id;
  else
    select * into cy from clipathon.cycles
     where status <> 'archived'
     order by registration_closes desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', a.platform, 'handle', a.handle, 'status', a.status,
           'code', case when a.status <> 'verified' then a.verification_code end
         ) order by a.created_at), '[]'::jsonb),
         bool_or(a.status = 'verified')
    into v_accts, v_verified
    from clipathon.creator_accounts a
   where a.creator_id = c.id;

  insert into clipathon.login_events (creator_id, auth_user_id, email, kind, user_agent)
  values (c.id, v_uid, v_email,
          case when v_first then 'first_login' else 'signin' end,
          left(coalesce(p_user_agent, ''), 400));

  return jsonb_build_object(
    'ok', true,
    'first_login', v_first,
    'creator', jsonb_build_object(
      'id', c.id, 'creator_code', c.creator_code, 'full_name', c.full_name,
      'display_name', coalesce(c.display_name, c.full_name), 'email', c.email,
      'phone', c.phone, 'city', c.city, 'campus', c.campus,
      'referral_code', c.referral_code),
    'registration', case when reg.id is null then null else jsonb_build_object(
      'id', reg.id, 'status', reg.status, 'cycle_id', reg.cycle_id,
      'categories', reg.content_categories, 'follower_band', reg.follower_band,
      'needs_info_reason', reg.needs_info_reason,
      'rejected_reason', reg.rejected_reason) end,
    'cycle', case when cy.id is null then null else jsonb_build_object(
      'id', cy.id, 'code', cy.code, 'name', cy.name, 'status', cy.status,
      'registration_closes', cy.registration_closes,
      'slots_open_at', cy.slots_open_at, 'slots_close_at', cy.slots_close_at,
      'submission_cutoff_at', cy.submission_cutoff_at, 'finale_at', cy.finale_at,
      'slots_per_brand', cy.slots_per_brand, 'prize_pool_minor', cy.prize_pool_minor) end,
    'accounts', coalesce(v_accts, '[]'::jsonb),
    -- The three gates the dashboard actually branches on, resolved here
    -- so the page cannot get the rule subtly wrong.
    'is_approved',   (reg.status = 'approved'),
    'has_verified_account', coalesce(v_verified, false),
    'can_select_slot', (reg.status = 'approved' and coalesce(v_verified, false)),
    'is_admin', exists (select 1 from clipathon.admin_users a
                         where a.user_id = v_uid and a.is_active)
  );
end;
$$;

comment on function clipathon.me is
  'Bootstrap for the login page and the dashboard. Links the auth user to the creator by verified email on first call, records the login, and returns the resolved gates.';

grant execute on function clipathon.me(text) to authenticated;

-- -------------------------------------------------------------
-- Has this email registered at all?
-- -------------------------------------------------------------
-- The sign in page needs to tell someone "you have not registered yet"
-- instead of a generic auth failure, but an anon function that answers
-- "does this email exist" is an enumeration oracle.
--
-- The compromise: this is callable only by a SIGNED IN user, and only
-- about their own verified email. Someone who guessed an address still
-- has to pass email confirmation to ask about it, at which point they
-- already control the inbox.
create or replace function clipathon.my_registration_state()
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  v_email text;
  c       record;
  reg     record;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();

  select * into c from clipathon.creators where email = v_email;
  if c.id is null then
    return jsonb_build_object('ok', true, 'registered', false, 'email', v_email);
  end if;

  select r.status into reg from clipathon.registrations r
   where r.creator_id = c.id
   order by r.created_at desc limit 1;

  return jsonb_build_object('ok', true, 'registered', true,
    'email', v_email, 'status', coalesce(reg.status::text, 'none'),
    'creator_code', c.creator_code);
end;
$$;

grant execute on function clipathon.my_registration_state() to authenticated;

-- -------------------------------------------------------------
-- Ops view: who is actually ready
-- -------------------------------------------------------------
create or replace view clipathon.v_creator_readiness
with (security_invoker = on) as
select
  c.id            as creator_id,
  c.creator_code,
  c.full_name,
  c.email,
  c.city,
  c.campus,
  r.cycle_id,
  r.status        as registration_status,
  (c.auth_user_id is not null)                       as has_login,
  (select max(created_at) from clipathon.login_events e where e.creator_id = c.id) as last_login_at,
  exists (select 1 from clipathon.creator_accounts a
           where a.creator_id = c.id and a.status = 'verified')  as has_verified_account,
  exists (select 1 from clipathon.slots s where s.registration_id = r.id) as has_slot,
  (r.status = 'approved'
     and c.auth_user_id is not null
     and exists (select 1 from clipathon.creator_accounts a
                  where a.creator_id = c.id and a.status = 'verified')) as ready_for_slot_selection
from clipathon.creators c
join clipathon.registrations r on r.creator_id = c.id;

comment on view clipathon.v_creator_readiness is
  'The pre-flight list for slot selection day. Approved is not the same as ready: a creator with no login or no verified handle cannot take a slot.';

grant select on clipathon.login_events to authenticated;
