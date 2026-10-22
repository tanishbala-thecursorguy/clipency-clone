-- 014 · Make the per-campaign breakdown agree with the headline figure.
--
-- Five approved clips from May and June carry an approved_amount set by hand
-- at review time while earning_amount stayed 0, because cs_calc_earning only
-- prices a per_view clip once its metrics have been fetched and these never
-- were. $54 in total, across four creators.
--
-- approved_amount is the figure that has actually been honoured: three of the
-- four creators have already been paid at or above it, and
-- cx_clipper_available_balance - the function that decides what a creator may
-- withdraw - reads approved_amount too. So the dashboard headline and the
-- payout path already agree with each other. The only thing out of step was
-- this view, which reads earning_amount and therefore showed a creator
-- "Total earned $30" above a per-campaign breakdown of $0.00 and $0.00.
--
-- The fallback fires only where earning_amount is zero and approved_amount is
-- not. Where both are zero - a per-video clip before settlement, or a per-view
-- clip under its minimum - nothing changes, because the coalesce lands on the
-- same zero. It can only ever raise a displayed 0 to the number the payout
-- path was already using; it can never lower anything, and it does not touch
-- the client spend view or the agency margin.
create or replace view public.v_cx_creator_campaign_earnings
with (security_invoker = true) as
 WITH base AS (
         SELECT s.user_id,
            s.campaign_id,
            c.id AS campaign_uuid,
            c.title,
            c.currency,
            COALESCE(c.payout_model, 'per_view'::text) AS payout_model,
            COALESCE(c.rate_per_video, 0::numeric) AS rate,
            COALESCE(c.min_videos_per_creator, 0) AS min_videos,
            c.max_videos_per_creator AS max_videos,
            c.max_pay_per_creator AS max_pay,
            count(*) FILTER (WHERE s.status = 'approved'::text) AS approved_clips,
            COALESCE(sum(COALESCE(NULLIF(s.earning_amount_native, 0::numeric),
                                  NULLIF(s.earning_amount, 0::numeric),
                                  s.approved_amount,
                                  0::numeric)), 0::numeric) AS settled_native,
            COALESCE(sum(COALESCE(NULLIF(s.earning_amount, 0::numeric),
                                  s.approved_amount,
                                  0::numeric)), 0::numeric) AS settled_usd,
            GREATEST(COALESCE(c.fx_rate_per_usd, 1::numeric), 0.000001) AS fx
           FROM clip_submissions s
             JOIN campaigns c ON c.id::text = s.campaign_id
          WHERE s.user_id = auth.uid() OR cx_is_staff()
          GROUP BY s.user_id, s.campaign_id, c.id, c.title, c.currency, c.payout_model, c.rate_per_video, c.min_videos_per_creator, c.max_videos_per_creator, c.max_pay_per_creator, c.fx_rate_per_usd
        )
 SELECT user_id,
    campaign_id,
    campaign_uuid,
    title,
    currency,
    payout_model,
    rate AS rate_per_video,
    approved_clips,
    min_videos,
    GREATEST(min_videos - approved_clips, 0::bigint) AS clips_to_unlock,
    payout_model = 'per_video'::text AND approved_clips < min_videos AS locked,
    round(settled_native, 2) AS settled_native,
    round(settled_usd, 2) AS settled_usd,
        CASE
            WHEN payout_model = 'per_video'::text AND approved_clips < min_videos THEN round(settled_native, 2)
            ELSE 0::numeric
        END AS locked_native,
        CASE
            WHEN payout_model = 'per_video'::text AND approved_clips < min_videos THEN round(settled_usd, 2)
            ELSE 0::numeric
        END AS locked_usd,
    max_videos AS max_videos_per_creator,
    max_pay AS max_pay_per_creator
   FROM base;
