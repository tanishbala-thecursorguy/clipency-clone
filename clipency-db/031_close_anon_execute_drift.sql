-- 031_close_anon_execute_drift.sql
-- Functions created after 20260602 (revoke_public_from_all_functions) came back
-- with Postgres's default EXECUTE grant to PUBLIC, which anon inherits, and a
-- few admin RPCs were re-created with an explicit grant to anon. The rule the
-- team set (20260602053752 grant_back_legitimate_function_access, extended by
-- 20260828084946 grant_private_campaign_helpers_to_anon) is that anon may call
-- exactly three functions in public:
--   submit_landing_lead(jsonb)           the landing-page lead form
--   cx_is_approved_for_campaign(uuid)    evaluated by RLS on campaigns for anon
--   cx_is_campaign_client(uuid)          evaluated by RLS on campaigns for anon
-- Every other SECURITY DEFINER function anon can execute today loses it here
-- (21 as of 2026-10-11, among them cx_settle_creator_campaign, which writes
-- settlements, cx_locked_earnings, which reads any creator's number, and the
-- admin_* budget/payout RPCs, gated in the body but needlessly reachable).
-- Nothing changes for signed-in users or the edge functions: authenticated and
-- service_role are granted explicitly before PUBLIC is revoked. Trigger
-- functions are skipped (EXECUTE is never checked when a trigger fires) and so
-- is everything that is not SECURITY DEFINER (citext operators, pure helpers).
-- Re-runnable: a second run finds nothing to do.

do $$
declare
  fn   record;
  keep text[] := array['submit_landing_lead', 'cx_is_approved_for_campaign', 'cx_is_campaign_client'];
  n    int := 0;
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
      and not (p.proname = any(keep))
    order by p.proname
  loop
    execute format('grant execute on function %s to authenticated, service_role', fn.sig);
    execute format('revoke execute on function %s from public, anon', fn.sig);
    n := n + 1;
    raise notice '031: closed anon on %', fn.sig;
  end loop;
  raise notice '031: % function(s) closed to anon', n;
end $$;

-- Check afterwards (expect exactly the three kept names):
--   select p.proname from pg_proc p
--   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
--     and pg_get_function_result(p.oid) <> 'trigger'
--     and has_function_privilege('anon', p.oid, 'execute')
--   order by 1;
