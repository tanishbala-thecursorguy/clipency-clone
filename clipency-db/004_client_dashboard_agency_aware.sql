/* Applied to spwtkdgpgeutrhwcjrpy on 2026-09-08.
   What a brand is shown on an agency campaign.

   The markup itself is ordinary reselling: the brand agreed to their rate,
   the creator agreed to theirs, and neither is told an untruth about their
   own deal. The line this function holds is narrower and absolute — the
   brand is never shown a number that ASSERTS what creators are paid.

   On a campaign carrying a margin:
     · the rate returned is the brand's own billed rate
     · spend and remaining are counted at that rate, because that is what
       their budget is actually consumed at
     · creator_pool and platform_fee come back NULL rather than recalculated
     · the raw fee inputs (platform_fee_percent / _amount) are stripped for
       everyone, because the portal's db.js used to fall back to recomputing
       the fee from them — which would have handed the brand Clipency's cut
       on exactly the campaigns where it is none of their business

   Campaigns with no margin behave exactly as before. */

create or replace function public.client_dashboard_data()
returns jsonb language plpgsql security definer set search_path to 'public'
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
             'currency', coalesce(c.currency,'USD'), 'fx_rate_per_usd', fx,
             'is_agency', agency,
             'rate_per_video_native', case when agency then coalesce(c.client_rate_per_video,0)
                                           else coalesce(c.rate_per_video,0) end,
             'rpm_native',            case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end,
             'rate_per_video', round((case when agency then coalesce(c.client_rate_per_video,0)
                                           else coalesce(c.rate_per_video,0) end)/fx, 2),
             'rpm',            round((case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end)/fx, 2),
             'budget_native',  coalesce(c.budget,0),
             'budget',         round(coalesce(c.budget,0)/fx, 2),
             'spent',          round(coalesce(c.budget_used,0)/ratio/fx, 2),
             'remaining',      greatest(round((coalesce(c.budget,0) - coalesce(c.budget_used,0)/ratio)/fx, 2), 0),
             'platform_fee',   case when agency then null else round(public.campaign_fee(c)/fx, 2) end,
             'creator_pool',   case when agency then null else round(public.campaign_creator_pool(c)/fx, 2) end,
             'can_fund',       (c.client_user_id = uid),
             'shared_with',    (select count(*) from public.campaign_clients x
                                 where x.campaign_id = c.id and x.client_user_id <> uid))
        order by c.created_at desc)
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      cross join lateral (select greatest(public.campaign_rate_ratio(c),0.000001) as ratio) g
      cross join lateral (select public.campaign_agency_margin(c) > 0 as agency) h
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid), '[]'::jsonb),

    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'campaign_id', s.campaign_id, 'campaign_title', s.campaign_title,
               'platform', s.platform, 'handle', s.handle, 'clip_url', s.clip_url,
               'views', s.views_count, 'likes', s.likes, 'comments', s.comments,
               'engagement_rate', s.engagement_rate, 'status', s.status,
               /* what this clip cost the BRAND, not what the creator was paid */
               'earned', round(coalesce(s.approved_amount,0)
                               / greatest(public.campaign_rate_ratio(c),0.000001), 2),
               'earned_native', round(coalesce(s.earning_amount_native, s.approved_amount, 0)
                               / greatest(public.campaign_rate_ratio(c),0.000001), 2),
               'created_at', s.created_at, 'flagged_at', s.flagged_at,
               'flag', (select jsonb_build_object('id', f.id, 'reason', f.reason,
                          'by', coalesce(f.flagged_email, 'a client'), 'by_me', (f.flagged_by = uid),
                          'resolution', f.resolution, 'note', f.resolution_note, 'at', f.created_at)
                        from public.clip_flags f where f.submission_id = s.id
                        order by f.created_at desc limit 1)))
      from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
      where s.status in ('approved','flagged')
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    'wallet', jsonb_build_object(
      'balance', public.client_wallet_balance(uid),
      'ledger', coalesce((
        select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'amount', l.amount,
                 'campaign_id', l.campaign_id, 'note', l.note, 'created_at', l.created_at)
               order by l.created_at desc)
        from public.client_wallet_ledger l where l.client_user_id = uid), '[]'::jsonb)),

    'totals', (
      select jsonb_build_object(
        'funded', coalesce(sum(round(coalesce(c.budget,0)/f.fx, 2)),0),
        /* withheld once any campaign in the set carries a margin */
        'platform_fee', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_fee(c)/f.fx, 2)),0) end,
        'creator_pool', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_creator_pool(c)/f.fx, 2)),0) end,
        'spent', coalesce(sum(round(coalesce(c.budget_used,0)
                          / greatest(public.campaign_rate_ratio(c),0.000001) / f.fx, 2)),0))
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid)
  ) into result;
  return result;
end
$function$;
