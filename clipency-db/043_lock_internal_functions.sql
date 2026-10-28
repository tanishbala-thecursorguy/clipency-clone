-- 043: lock database functions that any signed-in user can call today.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-28 with the owner's approval.
-- Found by the read-only audit on 2026-10-28.
--
-- Every function below is SECURITY DEFINER (runs with full rights) and has no
-- admin or "own data only" check. Part 1 removes direct access only: the
-- triggers, cron jobs and functions that use them internally all run as the owner,
-- so they keep working (checked: every caller is itself SECURITY DEFINER).
-- No table, row or column is changed.

begin;

-- Part 1a: Telegram. Today any signed-in creator or client can post any message
-- into the team Telegram group through the bot, or trigger the digests.
revoke execute on function public.tg_send(text, text, jsonb)  from public, anon, authenticated;
revoke execute on function public.tg_digest_finance()         from public, anon, authenticated;
revoke execute on function public.tg_digest_ops()             from public, anon, authenticated;
revoke execute on function public.tg_digest_outreach()        from public, anon, authenticated;

-- Part 1b: earnings internals. Today anyone signed in can read another creator's
-- locked earnings, or re-run the earnings calculation for any creator and campaign.
-- The app never calls these directly; only other database functions do.
revoke execute on function public.cx_locked_earnings(uuid)               from public, anon, authenticated;
revoke execute on function public.cx_settle_creator_campaign(uuid, text) from public, anon, authenticated;

-- Part 2: admin_get_stats. The old admin script (clipency-admin-os.js) calls it,
-- so it stays callable, but only staff get an answer. Today any signed-in user can
-- read platform totals: creators, payouts, total paid out and earnings.
create or replace function public.admin_get_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cx_is_staff() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return json_build_object(
    'total_clippers', (select count(*) from profiles),
    'active_campaigns', (select count(*) from campaigns where status = 'active'),
    'pending_reviews', (select count(*) from clip_submissions where status = 'pending'),
    'pending_accounts', (select count(*) from connected_accounts where status = 'pending'),
    'pending_payouts', (select count(*) from payout_requests where status = 'pending'),
    'total_paid_out', (select coalesce(sum(amount), 0) from payout_requests where status = 'paid'),
    'total_earnings_approved', (select coalesce(sum(earning_amount), 0) from clip_submissions where status = 'approved'),
    'rejected_submissions', (select count(*) from clip_submissions where status = 'rejected')
  );
end;
$$;

-- Left out on purpose: revoking anon SELECT on leads / user_session_logs. Row security
-- already returns zero rows, and the old auth.html lead form posts with
-- "return=representation", which may need it. Revisit when auth.html is retired.

commit;
