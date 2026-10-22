-- =============================================================
-- CLIPATHON · 012 · the API the browser actually talks to
-- =============================================================
-- Two problems this solves.
--
-- 1. PostgREST only serves schemas on its exposed list, which is
--    `public, graphql_public` by default. The dashboard cannot reach
--    clipathon.* until the schema is added. Exposing it is safe: `anon`
--    has no USAGE on the schema and no policy anywhere grants it a row,
--    so an exposed schema plus a leaked publishable key still yields
--    nothing.
--
-- 2. Registration happens BEFORE the person has an account. There is
--    deliberately no insert policy on creators or registrations, so a
--    signup cannot be a plain table insert. It goes through one
--    SECURITY DEFINER function that validates everything and is the
--    only thing `anon` may execute in this schema.
-- =============================================================

-- -------------------------------------------------------------
-- Expose the schema to PostgREST
-- -------------------------------------------------------------
-- Role-level config, which Supabase's PostgREST reads from the database.
-- Reverting is one line:  alter role authenticator reset pgrst.db_schemas;
--
-- NOTE: this sets the list explicitly. `public, graphql_public` is the
-- Supabase default; if the API settings had extra schemas added by hand,
-- add them here too or they stop being served.
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, clipathon';
notify pgrst, 'reload config';

-- -------------------------------------------------------------
-- Registration
-- -------------------------------------------------------------
-- The only function `anon` can call. Everything the signup form
-- collects arrives here, gets validated, and becomes a creator plus a
-- registration in one transaction.
--
-- Returning a jsonb envelope rather than raising on the ordinary
-- failures (duplicate email, closed cycle) so the form can show a
-- useful message instead of a Postgres error string.
create or replace function clipathon.register_creator(
  p_full_name       text,
  p_email           text,
  p_phone           text,
  p_profile_url     text,
  p_city            text        default null,
  p_campus          text        default null,
  p_secondary_url   text        default null,
  p_follower_band   text        default null,
  p_categories      text[]      default '{}',
  p_ref_code        text        default null,
  p_terms_accepted  boolean     default false
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  cy         record;
  existing   record;
  v_creator  uuid;
  v_code     text;
  v_ref      text;
  v_amb      uuid;
  v_referrer uuid;
  v_reg      uuid;
  n          integer := 0;
begin
  -- ---- validate -------------------------------------------------
  if coalesce(trim(p_full_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'name_required',
      'message', 'Enter your full name as it should appear on your certificate.');
  end if;

  p_email := lower(trim(p_email));
  if p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'error', 'email_invalid',
      'message', 'That email address does not look right.');
  end if;

  -- Keep digits and a leading +, so the same number typed three ways
  -- cannot become three creators.
  p_phone := regexp_replace(trim(p_phone), '[^0-9+]', '', 'g');
  if length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 10 then
    return jsonb_build_object('ok', false, 'error', 'phone_invalid',
      'message', 'Enter a valid phone number with country code.');
  end if;

  if p_profile_url !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'profile_invalid',
      'message', 'Your profile link must be a full public URL.');
  end if;

  if not p_terms_accepted then
    return jsonb_build_object('ok', false, 'error', 'terms_required',
      'message', 'You have to accept the content rights terms to enter.');
  end if;

  -- ---- is a cycle actually taking registrations? -----------------
  select * into cy
    from clipathon.cycles
   where status in ('draft', 'registration')
     and now() < registration_closes
   order by registration_closes
   limit 1;

  if cy is null then
    return jsonb_build_object('ok', false, 'error', 'closed',
      'message', 'Registration is not open right now. Watch the Clipathon page for the next cycle.');
  end if;

  -- ---- the person -----------------------------------------------
  -- A creator is reused across cycles, so a returning creator keeps
  -- their code, their referral code and their history.
  select * into existing from clipathon.creators where email = p_email;

  if existing.id is not null then
    if existing.is_blocked then
      return jsonb_build_object('ok', false, 'error', 'blocked',
        'message', 'This account cannot enter. Contact support if you think that is wrong.');
    end if;
    v_creator := existing.id;
    v_code    := existing.creator_code;
    v_ref     := existing.referral_code;
  else
    -- Same phone under a different email is a duplicate, which is one
    -- of the things verification is supposed to catch. Catch it here.
    if exists (select 1 from clipathon.creators where phone = p_phone) then
      return jsonb_build_object('ok', false, 'error', 'phone_taken',
        'message', 'That phone number is already registered with a different email.');
    end if;

    -- Short, human-readable, and unique. Retry rather than trusting a
    -- single random draw.
    loop
      n := n + 1;
      v_code := 'CLP-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
      exit when not exists (select 1 from clipathon.creators where creator_code = v_code);
      if n > 50 then
        v_code := 'CLP-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
        exit;
      end if;
    end loop;
    v_ref := 'CLIP-' || substr(v_code, 5);

    insert into clipathon.creators
      (creator_code, full_name, display_name, email, phone, city, campus, referral_code)
    values
      (v_code, trim(p_full_name), trim(p_full_name), p_email, p_phone,
       nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_campus, '')), ''), v_ref)
    returning id into v_creator;
  end if;

  -- ---- already entered this cycle? -------------------------------
  select * into existing from clipathon.registrations
   where cycle_id = cy.id and creator_id = v_creator;

  if existing.id is not null then
    return jsonb_build_object(
      'ok', true, 'already_registered', true,
      'creator_code', v_code, 'referral_code', v_ref,
      'status', existing.status,
      'cycle', cy.name,
      'message', 'You are already registered for ' || cy.name || '.');
  end if;

  -- ---- referral attribution --------------------------------------
  -- A code can belong to a campus ambassador or to another creator.
  -- Ambassadors are checked first because their codes are issued by us.
  if coalesce(trim(p_ref_code), '') <> '' then
    p_ref_code := upper(trim(p_ref_code));
    select id into v_amb from clipathon.ambassadors
     where upper(ref_code) = p_ref_code and cycle_id = cy.id and is_active;
    if v_amb is null then
      select id into v_referrer from clipathon.creators
       where upper(referral_code) = p_ref_code and id <> v_creator;
    end if;
  end if;

  insert into clipathon.registrations (
    cycle_id, creator_id, primary_profile_url, secondary_profile_url,
    follower_band, content_categories, ref_code_used, ambassador_id, referred_by,
    terms_accepted_at, terms_version, status
  ) values (
    cy.id, v_creator, trim(p_profile_url), nullif(trim(coalesce(p_secondary_url, '')), ''),
    nullif(trim(coalesce(p_follower_band, '')), ''), coalesce(p_categories, '{}'),
    nullif(p_ref_code, ''), v_amb, v_referrer,
    now(), 'v1', 'pending'
  )
  returning id into v_reg;

  return jsonb_build_object(
    'ok', true, 'already_registered', false,
    'creator_code', v_code, 'referral_code', v_ref,
    'registration_id', v_reg, 'status', 'pending',
    'cycle', cy.name,
    'referred', (v_amb is not null or v_referrer is not null),
    'message', 'You are in the queue. We review every registration by hand and email you within a few hours.');
end;
$$;

comment on function clipathon.register_creator is
  'Public signup. The only function anon may execute in this schema, because registration happens before an account exists and there is no insert policy on creators or registrations.';

-- -------------------------------------------------------------
-- Linking the login to the creator row
-- -------------------------------------------------------------
-- The creator registers by email, then signs in later with a magic
-- link on that same address. This claims their row on first sign in.
-- Matching on the verified JWT email, never on anything the client sends.
create or replace function clipathon.link_auth_user()
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  v_email text;
  c       record;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'no_email');
  end if;

  select * into c from clipathon.creators where email = v_email;
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_registered',
      'message', 'No Clipathon registration found for ' || v_email || '.');
  end if;

  -- Already claimed by a different account: refuse rather than steal it.
  if c.auth_user_id is not null and c.auth_user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'already_linked',
      'message', 'This registration is already linked to another login.');
  end if;

  if c.auth_user_id is null then
    update clipathon.creators
       set auth_user_id = auth.uid(), email_verified_at = coalesce(email_verified_at, now())
     where id = c.id;
  end if;

  return jsonb_build_object('ok', true, 'creator_id', c.id, 'creator_code', c.creator_code);
end;
$$;

-- -------------------------------------------------------------
-- Account verification, the bio code flow
-- -------------------------------------------------------------
-- request_account_code issues the code. The handle is reserved at this
-- point, which is what stops two creators racing for the same one.
create or replace function clipathon.request_account_code(
  p_platform text,
  p_handle   text
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  me     uuid := clipathon.my_creator_id();
  h      text := lower(regexp_replace(trim(p_handle), '^@+', ''));
  plat   clipathon.account_platform;
  v_code text;
  owner  uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  if h !~ '^[a-z0-9._-]{2,30}$' then
    return jsonb_build_object('ok', false, 'error', 'handle_invalid',
      'message', 'Usernames are letters, numbers, dots, underscores and hyphens.');
  end if;

  begin
    plat := p_platform::clipathon.account_platform;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'platform_invalid');
  end;

  select creator_id into owner from clipathon.creator_accounts
   where platform = plat and handle = h;

  if owner is not null and owner <> me then
    return jsonb_build_object('ok', false, 'error', 'handle_taken',
      'message', 'That handle is already claimed by another creator.');
  end if;

  v_code := 'CLIP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  insert into clipathon.creator_accounts
    (creator_id, platform, handle, status, verification_code, code_expires_at)
  values
    (me, plat, h, 'pending', v_code, now() + interval '24 hours')
  on conflict (platform, handle) do update
     set verification_code = excluded.verification_code,
         code_expires_at   = excluded.code_expires_at,
         status            = case when clipathon.creator_accounts.status = 'verified'
                                  then 'verified' else 'pending' end,
         verify_error      = null,
         updated_at        = now();

  return jsonb_build_object('ok', true, 'code', v_code, 'handle', h,
    'expires_at', now() + interval '24 hours');
end;
$$;

-- submit_account_for_check records that the creator says the code is in
-- their bio.
--
-- It does NOT mark the account verified, and that is deliberate. Real
-- verification means fetching the public profile and finding the code,
-- which needs an outbound HTTP call this database should not be making.
-- A function that trusted the client here would let anyone self-grant a
-- verified handle and, because handles are unique, squat someone else's.
-- The checker (edge function or reviewer) is what flips it.
create or replace function clipathon.submit_account_for_check(
  p_platform text,
  p_handle   text
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  me   uuid := clipathon.my_creator_id();
  h    text := lower(regexp_replace(trim(p_handle), '^@+', ''));
  plat clipathon.account_platform;
  a    record;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'not_linked');
  end if;
  begin
    plat := p_platform::clipathon.account_platform;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'platform_invalid');
  end;

  select * into a from clipathon.creator_accounts
   where platform = plat and handle = h and creator_id = me;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if a.status = 'verified' then
    return jsonb_build_object('ok', true, 'status', 'verified');
  end if;
  if a.code_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'code_expired',
      'message', 'That code expired. Request a new one.');
  end if;
  if a.verify_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many',
      'message', 'Too many attempts. Raise a support ticket and we will check it by hand.');
  end if;

  update clipathon.creator_accounts
     set verify_attempts = verify_attempts + 1,
         last_verify_at  = now(),
         updated_at      = now()
   where id = a.id;

  return jsonb_build_object('ok', true, 'status', 'pending',
    'message', 'Submitted. We check the bio and your handle turns verified, usually within a few minutes.');
end;
$$;

comment on function clipathon.submit_account_for_check is
  'Records the creator claim only. Verification is flipped by the checker, never by the client, or anyone could self-grant a handle.';

-- -------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------
-- anon gets exactly one function and nothing else: not the schema, not
-- a table, not a view.
grant usage on schema clipathon to anon;
revoke all on all tables in schema clipathon from anon;
revoke all on all functions in schema clipathon from anon;
grant execute on function clipathon.register_creator(
  text, text, text, text, text, text, text, text, text[], text, boolean) to anon;

-- Signed-in creators get the three that operate on their own row. Table
-- access stays governed by the policies in 008.
grant execute on function clipathon.link_auth_user()                       to authenticated;
grant execute on function clipathon.request_account_code(text, text)       to authenticated;
grant execute on function clipathon.submit_account_for_check(text, text)   to authenticated;
grant execute on function clipathon.register_creator(
  text, text, text, text, text, text, text, text, text[], text, boolean) to authenticated;

-- The RLS helpers are called from inside policies, never by a client.
revoke execute on function clipathon.is_admin()          from anon, authenticated;
revoke execute on function clipathon.has_role(clipathon.admin_role[]) from anon, authenticated;
revoke execute on function clipathon.my_creator_id()     from anon;
revoke execute on function clipathon.owns_registration(uuid) from anon;

grant select on all tables in schema clipathon to authenticated;
grant insert, update on clipathon.slots, clipathon.submissions,
      clipathon.task_completions, clipathon.support_tickets,
      clipathon.ticket_messages, clipathon.creators to authenticated;
