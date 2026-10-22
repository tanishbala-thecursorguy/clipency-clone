-- 016 · Per-video campaigns: the client is billed approved clips x client rate.
--
-- Ayush's call (23 Sep 2026): whatever rate the agency sets for the brand is
-- the rate the client dashboard bills at, applied to every approved clip.
-- Vingo: 55 approved x $2.50 must read $137.50, not the $110.50 it showed.
--
-- Before this, a per-video clip's client price was its creator stamp
-- (approved_amount) divided by campaign_rate_ratio(). Two ways that went wrong:
--   1. client_rate_per_video = 0 (no brand rate set) gives ratio 1, so the
--      client was shown the CREATOR's own stamped amounts.
--   2. The ratio uses TODAY's rates against stamps made at an OLD rate, so a
--      mid-campaign rate change left the card saying "at $2.50 per approved
--      video" above a total built from $2.00 stamps. Label and total disagreed.
--
-- Now, for per_video only:
--   client unit rate = client_rate_per_video if set (> 0), else rate_per_video
--   per clip         = unit rate
--   spent            = approved clips x unit rate
-- The label, every clip and the progress bar all read that one number.
--
-- Deliberately untouched:
--   * clip_submissions.approved_amount, campaigns.budget_used and every
--     creator payout. This is a client-facing figure only.
--   * per_view campaigns keep the existing approved_amount / ratio path.
--   * platform_fee / creator_pool stay withheld on agency campaigns.

create or replace function public.campaign_client_unit_rate(c public.campaigns)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(nullif(c.client_rate_per_video, 0), c.rate_per_video, 0);
$$;

-- Only ever called from inside security-definer functions.
revoke execute on function public.campaign_client_unit_rate(public.campaigns) from public, anon, authenticated;

create or replace function public.client_dashboard_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;

  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(
        (to_jsonb(c) - 'client_pin' - 'rate_per_video' - 'rpm'
                     - 'client_rate_per_video' - 'client_rpm'
                     - 'platform_fee_percent' - 'platform_fee_amount')
        || jsonb_build_object(
             'currency',        coalesce(c.currency,'USD'),
             'fx_rate_per_usd', fx,
             'is_agency',       agency,
             'rate_per_video_native', unit,
             'rpm_native',            case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end,
             'rate_per_video', round(unit/fx, 2),
             'rpm',            round((case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end)/fx, 2),
             'budget_native',  coalesce(c.budget,0),
             'budget',         round(coalesce(c.budget,0)/fx, 2),
             'spent',          round(spent_native/fx, 2),
             'remaining',      greatest(round((coalesce(c.budget,0) - spent_native)/fx, 2), 0),
             'platform_fee',   case when agency then null
                                    else round(public.campaign_fee(c)/fx, 2) end,
             'creator_pool',   case when agency then null
                                    else round(public.campaign_creator_pool(c)/fx, 2) end,
             'can_fund',       (c.client_user_id = uid),
             'shared_with',    (select count(*) from public.campaign_clients x
                                 where x.campaign_id = c.id and x.client_user_id <> uid)
           )
        order by c.created_at desc)
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      cross join lateral (select greatest(public.campaign_rate_ratio(c),0.000001) as ratio) g
      cross join lateral (select public.campaign_agency_margin(c) > 0 as agency) h
      cross join lateral (select public.campaign_client_unit_rate(c) as unit) u
      cross join lateral (
        select case when coalesce(c.payout_model,'per_view') = 'per_video'
                    then (select count(*) from public.clip_submissions s
                           where s.campaign_id = c.id::text and s.status = 'approved') * unit
                    else coalesce(c.budget_used,0) / ratio end as spent_native) sp
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid), '[]'::jsonb),

    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'campaign_id', s.campaign_id, 'campaign_title', s.campaign_title,
               'platform', s.platform, 'handle', s.handle, 'clip_url', s.clip_url,
               'views', s.views_count, 'likes', s.likes, 'comments', s.comments,
               'engagement_rate', s.engagement_rate, 'status', s.status,
               'earned', case when pv
                              then round(public.campaign_client_unit_rate(c)
                                         / greatest(coalesce(c.fx_rate_per_usd,1),0.000001), 2)
                              else round(coalesce(s.approved_amount,0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,
               'earned_native', case when pv
                              then round(public.campaign_client_unit_rate(c), 2)
                              else round(coalesce(s.earning_amount_native, s.approved_amount, 0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,
               'created_at', s.created_at,
               'flagged_at', s.flagged_at,
               'flag', (select jsonb_build_object(
                          'id', f.id, 'reason', f.reason,
                          'by', coalesce(f.flagged_email, 'a client'),
                          'by_me', (f.flagged_by = uid),
                          'resolution', f.resolution,
                          'note', f.resolution_note,
                          'at', f.created_at)
                        from public.clip_flags f
                        where f.submission_id = s.id
                        order by f.created_at desc limit 1)))
      from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
      cross join lateral (select coalesce(c.payout_model,'per_view') = 'per_video' as pv) m
      where s.status in ('approved','flagged')
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    'wallet', jsonb_build_object(
      'balance', public.client_wallet_balance(uid),
      'ledger', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'kind', l.kind, 'amount', l.amount,
                 'campaign_id', l.campaign_id, 'note', l.note, 'created_at', l.created_at)
               order by l.created_at desc)
        from public.client_wallet_ledger l
        where l.client_user_id = uid), '[]'::jsonb)
    ),

    'totals', (
      select jsonb_build_object(
        'funded',       coalesce(sum(round(coalesce(c.budget,0)/f.fx, 2)),0),
        'platform_fee', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_fee(c)/f.fx, 2)),0) end,
        'creator_pool', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_creator_pool(c)/f.fx, 2)),0) end,
        'spent',        coalesce(sum(round(
                          case when coalesce(c.payout_model,'per_view') = 'per_video'
                               then (select count(*) from public.clip_submissions s
                                      where s.campaign_id = c.id::text and s.status = 'approved')
                                    * public.campaign_client_unit_rate(c)
                               else coalesce(c.budget_used,0)
                                    / greatest(public.campaign_rate_ratio(c),0.000001) end
                          / f.fx, 2)),0)
      )
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid
    )
  ) into result;

  return result;
end
$function$;
