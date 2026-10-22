/* ============================================================
   Applied to Supabase project spwtkdgpgeutrhwcjrpy on 2026-09-08.
   Agency margin + per-creator payout rules.

   TWO RATES. A campaign run for an agency carries the rate the creator
   is paid AND the rate the brand is billed. The spread is the agency's.
   Both are real prices in real agreements, so neither side is told an
   untruth about their own deal. What must never happen is the
   brand-facing rate being presented as creator compensation — that
   would be a false statement about a third party. See 003 for how the
   client read path holds that line.

   FEE ON TOP. On these campaigns Clipency invoices its fee outside the
   budget, so the whole budget reaches creators + agency. That is the
   opposite of the existing behaviour, hence an explicit fee_mode rather
   than an inferred rule. Existing campaigns default to 'inclusive' and
   are untouched.

   PER-CREATOR RULES (per_video only): a creator must deliver a minimum
   number of approved videos before any of them pay — retroactively,
   the earlier ones are held rather than forfeited — no more than a
   maximum are paid for, and their total can be capped.
   ============================================================ */

alter table public.campaigns
  add column if not exists client_rate_per_video numeric default 0,
  add column if not exists client_rpm            numeric default 0,
  add column if not exists fee_mode text not null default 'inclusive',
  add column if not exists min_videos_per_creator integer not null default 0,
  add column if not exists max_videos_per_creator integer,
  add column if not exists max_pay_per_creator    numeric;

alter table public.campaigns drop constraint if exists campaigns_fee_mode_chk;
alter table public.campaigns add constraint campaigns_fee_mode_chk
  check (fee_mode in ('inclusive','on_top'));

/* A brand rate below the creator rate means the agency pays to work,
   which is always a data-entry mistake rather than an intent. */
alter table public.campaigns drop constraint if exists campaigns_client_rate_chk;
alter table public.campaigns add constraint campaigns_client_rate_chk check (
  (coalesce(client_rate_per_video,0) = 0 or coalesce(client_rate_per_video,0) >= coalesce(rate_per_video,0))
  and
  (coalesce(client_rpm,0) = 0 or coalesce(client_rpm,0) >= coalesce(rpm,0))
);

comment on column public.campaigns.client_rate_per_video is
  'What the brand is billed per approved video. 0 = no agency margin.';
comment on column public.campaigns.client_rpm is
  'What the brand is billed per 1M views. 0 = no agency margin.';
comment on column public.campaigns.fee_mode is
  'inclusive: platform fee comes out of budget. on_top: invoiced separately, whole budget spendable.';

/* The margin is earned per delivered video, not carved off as a block,
   so the creator share is simply the ratio of the two rates. At $1,250
   budget, $2.50 brand / $2.00 creator: ratio 0.8, pool $1,000, margin
   $250 — and if only 100 videos land the agency has earned $50 of that,
   not the whole $250. */
create or replace function public.campaign_rate_ratio(c public.campaigns)
returns numeric language sql immutable as $function$
  select case
    when coalesce(c.payout_model,'per_view') = 'per_video' then
      case when coalesce(c.client_rate_per_video,0) > 0 and coalesce(c.rate_per_video,0) > 0
           then least(c.rate_per_video / c.client_rate_per_video, 1) else 1 end
    else
      case when coalesce(c.client_rpm,0) > 0 and coalesce(c.rpm,0) > 0
           then least(c.rpm / c.client_rpm, 1) else 1 end
  end;
$function$;

create or replace function public.campaign_creator_pool(c public.campaigns)
returns numeric language sql immutable as $function$
  select greatest(round(
    (case when c.fee_mode = 'on_top' then coalesce(c.budget,0)
          else coalesce(c.budget,0) - public.campaign_fee(c) end)
    * public.campaign_rate_ratio(c), 2), 0);
$function$;

/* Reported, never paid out by this system — settlement with the agency
   happens outside it. */
create or replace function public.campaign_agency_margin(c public.campaigns)
returns numeric language sql immutable as $function$
  select greatest(round(
    (case when c.fee_mode = 'on_top' then coalesce(c.budget,0)
          else coalesce(c.budget,0) - public.campaign_fee(c) end)
    - public.campaign_creator_pool(c), 2), 0);
$function$;
