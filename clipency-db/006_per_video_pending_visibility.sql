-- =============================================================
-- CLIPENCY · 006 · a per-video creator's money, before it unlocks
-- =============================================================
-- Reported as "approved clips do not add to earnings" on a per-video
-- campaign. The settlement engine in 003 was not at fault. Proven on
-- the live Vingo campaign: three clips approved, metrics ok, views
-- fine, rate 2, campaign active, pool 1000. Every gate passed except
-- min_videos_per_creator, which was 8. Dropping it to 3 and settling
-- again paid all three at 2.00 immediately.
--
-- So zero was the correct answer to "what is owed". It was the wrong
-- answer to "what is happening", and both dashboards only ever asked
-- the first question. Nothing here changes what gets paid.
--
--   settled_*  what cx_settle_creator_campaign has actually written
--   pending_*  what those approved clips WOULD pay once the minimum
--              is met, honouring the same three caps the settlement
--              loop applies: max videos per creator, max pay per
--              creator, and what is left of the creator pool after
--              everybody else
--   locked     true while the minimum has not been reached
--
-- pending is zero once unlocked, because the settlement has written
-- the real figure by then and showing both would double count. That
-- is asserted, not assumed: see the regression at the bottom.
--
-- cx_settle_creator_campaign stays the authority on what is paid.
-- These views are a projection for the screen and are labelled as one.
--
-- The client view carries no creator pool, no creator rate and no
-- platform fee. Migration 004 established that a brand does not see
-- what the creator is paid on an agency campaign, and that holds here:
-- the brand sees its own rate, so Vingo reads 7.50 where the creator
-- reads 6.00 and the 1.50 margin stays where it belongs.
--
-- ALREADY APPLIED to the live project. Kept here as the record.
-- =============================================================
create or replace view public.v_cx_creator_campaign_earnings
with (security_invoker = on) as
with base as (
  select
    s.user_id,
    s.campaign_id,
    c.id                                    as campaign_uuid,
    c.title,
    c.currency,
    coalesce(c.payout_model, 'per_view')    as payout_model,
    coalesce(c.rate_per_video, 0)           as rate,
    coalesce(c.min_videos_per_creator, 0)   as min_videos,
    c.max_videos_per_creator                as max_videos,
    c.max_pay_per_creator                   as max_pay,
    c.max_pay_per_clip                      as max_per_clip,
    public.campaign_creator_pool(c)         as creator_pool,
    count(*) filter (where s.status = 'approved')            as approved_clips,
    count(*) filter (where s.status = 'approved'
                       and coalesce(s.views_count, 0) >= coalesce(c.min_views_per_clip, 0)
                       and coalesce(s.metrics_status, '') = 'ok')  as eligible_clips,
    coalesce(sum(coalesce(s.earning_amount_native, 0)), 0)   as settled_native,
    coalesce(sum(coalesce(s.earning_amount, 0)), 0)          as settled_usd,
    greatest(coalesce(c.fx_rate_per_usd, 1), 0.000001)       as fx
  from public.clip_submissions s
  join public.campaigns c on c.id::text = s.campaign_id
  group by s.user_id, s.campaign_id, c.id, c.title, c.currency, c.payout_model,
           c.rate_per_video, c.min_videos_per_creator, c.max_videos_per_creator,
           c.max_pay_per_creator, c.max_pay_per_clip, c.min_views_per_clip, c.fx_rate_per_usd
),
room as (
  select b.*,
    greatest(b.creator_pool - coalesce((
      select sum(coalesce(o.earning_amount_native, o.earning_amount, 0))
        from public.clip_submissions o
       where o.campaign_id = b.campaign_id
         and o.status = 'approved'
         and o.user_id <> b.user_id), 0), 0) as pool_room
  from base b
),
proj as (
  select r.*,
    least(
      r.eligible_clips * least(r.rate, coalesce(nullif(r.max_per_clip, 0), r.rate)),
      coalesce(nullif(r.max_pay, 0), 1e18),
      r.pool_room,
      case when r.max_videos is null or r.max_videos <= 0 then 1e18
           else least(r.eligible_clips, r.max_videos)
                * least(r.rate, coalesce(nullif(r.max_per_clip, 0), r.rate)) end
    ) as would_pay_native
  from room r
)
select
  user_id, campaign_id, campaign_uuid, title, currency, payout_model,
  rate                                            as rate_per_video,
  approved_clips,
  eligible_clips,
  min_videos,
  greatest(min_videos - eligible_clips, 0)         as clips_to_unlock,
  (payout_model = 'per_video' and eligible_clips < min_videos) as locked,
  round(settled_native, 2)                        as settled_native,
  round(settled_usd, 2)                           as settled_usd,
  case when payout_model = 'per_video' and eligible_clips < min_videos
       then round(greatest(would_pay_native, 0), 2) else 0 end as pending_native,
  case when payout_model = 'per_video' and eligible_clips < min_videos
       then round(greatest(would_pay_native, 0) / fx, 2) else 0 end as pending_usd,
  max_videos                                      as max_videos_per_creator,
  max_pay                                         as max_pay_per_creator
from proj;

create or replace view public.v_cx_client_campaign_spend
with (security_invoker = on) as
select
  c.id                                            as campaign_uuid,
  c.id::text                                      as campaign_id,
  c.title,
  c.currency,
  coalesce(c.payout_model, 'per_view')            as payout_model,
  coalesce(c.client_rate_per_video, c.rate_per_video, 0) as client_rate_per_video,
  count(*) filter (where s.status = 'approved')   as delivered_clips,
  count(*) filter (where s.status = 'approved'
                    and coalesce(s.earning_amount_native, 0) > 0) as billed_clips,
  round(count(*) filter (where s.status = 'approved'
                          and coalesce(s.earning_amount_native, 0) > 0)
        * coalesce(c.client_rate_per_video, c.rate_per_video, 0), 2) as billed_amount,
  count(*) filter (where s.status = 'approved'
                    and coalesce(s.earning_amount_native, 0) = 0) as pending_clips,
  round(count(*) filter (where s.status = 'approved'
                          and coalesce(s.earning_amount_native, 0) = 0)
        * coalesce(c.client_rate_per_video, c.rate_per_video, 0), 2) as pending_amount
from public.campaigns c
left join public.clip_submissions s on s.campaign_id = c.id::text
group by c.id, c.title, c.currency, c.payout_model, c.client_rate_per_video, c.rate_per_video;

-- -------------------------------------------------------------
-- Regression. Runs in a transaction and rolls back, so it can be
-- pointed at production. Every one of these held on the live data.
-- -------------------------------------------------------------
-- begin;
--   select count(*) = 0 as per_view_untouched
--     from public.v_cx_creator_campaign_earnings
--    where payout_model <> 'per_video' and (locked or pending_native <> 0);
--
--   select count(*) = 0 as never_both_pending_and_settled
--     from public.v_cx_creator_campaign_earnings
--    where pending_native > 0 and settled_native > 0;
--
--   select count(*) = 0 as pending_within_pool
--     from public.v_cx_creator_campaign_earnings e
--     join public.campaigns c on c.id = e.campaign_uuid
--    where e.pending_native > public.campaign_creator_pool(c) + 0.01;
--
--   select count(*) = 0 as pending_respects_creator_cap
--     from public.v_cx_creator_campaign_earnings
--    where max_pay_per_creator is not null and max_pay_per_creator > 0
--      and pending_native > max_pay_per_creator + 0.01;
--
--   -- the agency margin: the brand side is never below the creator side
--   select count(*) = 0 as margin_never_inverts
--     from public.v_cx_client_campaign_spend cl
--     join (select campaign_id, sum(settled_native + pending_native) amt
--             from public.v_cx_creator_campaign_earnings group by campaign_id) cr
--       on cr.campaign_id = cl.campaign_id
--    where cl.payout_model = 'per_video'
--      and (cl.billed_amount + cl.pending_amount) < cr.amt - 0.01;
-- rollback;
