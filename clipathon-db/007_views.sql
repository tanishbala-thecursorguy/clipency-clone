-- =============================================================
-- CLIPATHON · 007 · views for the dashboard and the admin console
-- =============================================================
-- Views are `security_invoker = on` so RLS on the underlying tables
-- still applies to whoever queries them. A view that bypassed RLS would
-- be a hole straight through 008.
-- =============================================================

-- -------------------------------------------------------------
-- Season leaderboard
-- -------------------------------------------------------------
-- Totals are a sum over the ledger, never a stored counter, and the
-- breakdown by source is what the dashboard shows as Tasks / Referrals
-- / Results on the creator's own row.
create or replace view clipathon.v_season_leaderboard
with (security_invoker = on) as
select
  l.season_id,
  l.creator_id,
  c.display_name,
  c.creator_code,
  sum(l.amount)                                                   as total_points,
  sum(l.amount) filter (where l.source = 'task')                  as task_points,
  sum(l.amount) filter (where l.source = 'referral')              as referral_points,
  sum(l.amount) filter (where l.source in ('result','streak'))    as result_points,
  sum(l.amount) filter (where l.source = 'adjustment')            as adjustment_points,
  count(distinct l.cycle_id) filter (where l.cycle_id is not null) as cycles_entered,
  rank() over (partition by l.season_id order by sum(l.amount) desc) as rank
from clipathon.points_ledger l
join clipathon.creators c on c.id = l.creator_id
group by l.season_id, l.creator_id, c.display_name, c.creator_code;

comment on view clipathon.v_season_leaderboard is
  'Live standings. sum() over the ledger, so an adjustment is reflected immediately and is attributable.';

-- -------------------------------------------------------------
-- Cycle results
-- -------------------------------------------------------------
create or replace view clipathon.v_cycle_results
with (security_invoker = on) as
select
  s.cycle_id,
  s.brand_id,
  b.name                as brand_name,
  sub.registration_id,
  r.creator_id,
  cr.display_name,
  cr.creator_code,
  sub.id                as submission_id,
  sub.post_url,
  ms.views,
  ms.engagement_rate,
  s.views_score,
  s.engagement_score,
  s.quality_score,
  s.compliance_score,
  s.total_score,
  s.rank_in_brand,
  s.rank_overall,
  (s.locked_at is not null) as is_final
from clipathon.scores s
join clipathon.submissions   sub on sub.id = s.submission_id
join clipathon.registrations r   on r.id   = sub.registration_id
join clipathon.creators      cr  on cr.id  = r.creator_id
join clipathon.brands        b   on b.id   = s.brand_id
left join clipathon.metric_snapshots ms on ms.id = s.snapshot_id;

-- -------------------------------------------------------------
-- Referral funnel
-- -------------------------------------------------------------
-- One row per referrer per cycle. Only `approved` pays, and the counts
-- below are cumulative through the funnel: a referral sitting at
-- 'submitted' also counts as invited and verified, while 'rejected' is
-- excluded from every stage because it left the funnel.
create or replace view clipathon.v_referral_funnel
with (security_invoker = on) as
select
  rf.cycle_id,
  rf.referrer_id,
  count(*) filter (where rf.stage <> 'rejected')                            as invited,
  count(*) filter (where rf.stage in ('verified','submitted','approved'))   as verified,
  count(*) filter (where rf.stage in ('submitted','approved'))              as submitted,
  count(*) filter (where rf.stage = 'approved')                             as approved,
  count(*) filter (where rf.stage = 'rejected')                             as not_approved,
  coalesce(sum(rf.points_awarded), 0)                                       as points_earned
from clipathon.referrals rf
group by rf.cycle_id, rf.referrer_id;

comment on view clipathon.v_referral_funnel is
  'Cumulative funnel. rejected referrals are excluded from every stage: they left the funnel and never pay.';

-- Top referrers, ranked on approved first and invited second so raw
-- volume alone cannot win it.
create or replace view clipathon.v_referral_leaderboard
with (security_invoker = on) as
select
  f.cycle_id,
  f.referrer_id,
  c.display_name,
  c.creator_code,
  f.invited,
  f.approved,
  f.points_earned,
  rank() over (partition by f.cycle_id order by f.approved desc, f.invited desc) as rank
from clipathon.v_referral_funnel f
join clipathon.creators c on c.id = f.referrer_id;

-- -------------------------------------------------------------
-- Slot fill, for the live counters during the window
-- -------------------------------------------------------------
create or replace view clipathon.v_brand_fill
with (security_invoker = on) as
select
  b.id            as brand_id,
  b.cycle_id,
  b.name,
  b.slug,
  b.slots_total,
  b.slots_taken,
  b.slots_total - b.slots_taken as slots_left,
  round((b.slots_taken::numeric / nullif(b.slots_total, 0)) * 100, 1) as pct_full,
  count(s.id) filter (where s.auto_assigned) as auto_assigned_count,
  case
    when b.slots_taken >= b.slots_total then 'full'
    when (b.slots_taken::numeric / nullif(b.slots_total, 0)) > 0.78 then 'fast'
    when (b.slots_taken::numeric / nullif(b.slots_total, 0)) > 0.50 then 'moderate'
    else 'open'
  end as velocity
from clipathon.brands b
left join clipathon.slots s on s.brand_id = b.id
group by b.id;

-- -------------------------------------------------------------
-- Admin console: the verification queue
-- -------------------------------------------------------------
-- The playbook calls verification the biggest bottleneck risk in the
-- event, so the queue is a first class view with age in hours, which is
-- what the daily clearance target is measured against.
create or replace view clipathon.v_verification_queue
with (security_invoker = on) as
select
  r.id            as registration_id,
  r.cycle_id,
  r.status,
  r.created_at,
  round(extract(epoch from (now() - r.created_at)) / 3600.0, 1) as age_hours,
  r.needs_info_until,
  c.id            as creator_id,
  c.full_name,
  c.email,
  c.phone,
  c.city,
  c.campus,
  r.primary_profile_url,
  r.follower_band,
  r.content_categories,
  r.ref_code_used,
  a.full_name     as ambassador_name
from clipathon.registrations r
join clipathon.creators c on c.id = r.creator_id
left join clipathon.ambassadors a on a.id = r.ambassador_id
where r.status in ('pending','needs_info');

-- -------------------------------------------------------------
-- Admin console: the QC queue
-- -------------------------------------------------------------
create or replace view clipathon.v_qc_queue
with (security_invoker = on) as
select
  sub.id          as submission_id,
  sub.cycle_id,
  sub.status,
  sub.is_complete,
  sub.post_url,
  sub.drive_url,
  sub.link_valid,
  sub.qc_note,
  sub.created_at,
  cy.submission_cutoff_at,
  (now() > cy.submission_cutoff_at) as past_cutoff,
  b.name          as brand_name,
  c.display_name,
  c.creator_code
from clipathon.submissions sub
join clipathon.cycles        cy on cy.id  = sub.cycle_id
join clipathon.brands        b  on b.id   = sub.brand_id
join clipathon.registrations r  on r.id   = sub.registration_id
join clipathon.creators      c  on c.id   = r.creator_id
where sub.status in ('complete','under_review','link_submitted','file_uploaded');

-- -------------------------------------------------------------
-- Admin console: acquisition against the target
-- -------------------------------------------------------------
create or replace view clipathon.v_cycle_health
with (security_invoker = on) as
select
  cy.id           as cycle_id,
  cy.name,
  cy.status,
  cy.total_slots,
  count(r.id)                                             as registrations,
  count(r.id) filter (where r.status = 'approved')        as verified_creators,
  count(r.id) filter (where r.status = 'pending')         as queue_pending,
  count(r.id) filter (where r.status = 'rejected')        as rejected,
  count(sl.id)                                            as slots_taken,
  count(sub.id) filter (where sub.is_complete)            as submissions_complete,
  count(sub.id) filter (where sub.status = 'verified')    as submissions_verified,
  count(sub.id) filter (where sub.status = 'disqualified') as disqualified
from clipathon.cycles cy
left join clipathon.registrations r  on r.cycle_id  = cy.id
left join clipathon.slots        sl on sl.cycle_id  = cy.id
left join clipathon.submissions  sub on sub.cycle_id = cy.id
group by cy.id;

-- -------------------------------------------------------------
-- Ambassador attribution
-- -------------------------------------------------------------
-- Paid on verified registrations only, never on raw signups. That is
-- the whole reason this is a view and not a counter on the ambassador.
create or replace view clipathon.v_ambassador_performance
with (security_invoker = on) as
select
  a.id            as ambassador_id,
  a.cycle_id,
  a.full_name,
  a.campus,
  a.ref_code,
  count(r.id)                                       as signups,
  count(r.id) filter (where r.status = 'approved')  as verified,
  count(r.id) filter (where r.status = 'rejected')  as rejected
from clipathon.ambassadors a
left join clipathon.registrations r on r.ambassador_id = a.id
group by a.id;
