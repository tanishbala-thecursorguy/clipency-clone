-- =============================================================
-- CLIPATHON · 015 · fix request_account_code enum cast
-- =============================================================
-- Found by running the creator lifecycle end to end on the real
-- database. request_account_code() failed on every call with:
--
--   column "status" is of type account_status but expression is of
--   type text
--
-- The bare literal in VALUES is fine, because an unknown-type literal
-- is resolved against the target column. The CASE in ON CONFLICT DO
-- UPDATE is not: it resolves to text first, and text does not
-- implicitly cast to an enum in an assignment.
--
-- The function parsed, deployed and passed the migration run. Nothing
-- short of calling it would have caught this, which is the argument
-- for exercising a lifecycle rather than only asserting that DDL
-- applies cleanly.
-- =============================================================

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
         -- The explicit cast is the fix. Re-issuing a code must never
         -- knock an already verified handle back to pending, so the
         -- CASE has to stay; it just has to be typed.
         status            = (case when clipathon.creator_accounts.status = 'verified'
                                   then 'verified' else 'pending' end)::clipathon.account_status,
         verify_error      = null,
         updated_at        = now();

  return jsonb_build_object('ok', true, 'code', v_code, 'handle', h,
    'expires_at', now() + interval '24 hours');
end;
$$;

grant execute on function clipathon.request_account_code(text, text) to authenticated;
