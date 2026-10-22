-- =============================================================
-- CLIPATHON · 001 · schema, types, admin roles, helpers
-- =============================================================
-- Everything Clipathon lives in its own `clipathon` schema, never in
-- `public`. That separation is the whole point of this migration set:
--
--   * The clipping console exposes `public` through PostgREST. The
--     Clipathon admin console exposes `clipathon`. Neither can reach the
--     other's tables by accident, and an anon key scoped to one is
--     useless against the other.
--   * Table names are free again. `campaigns`, `submissions` and
--     `admin_users` all already exist in `public` meaning something
--     different, and reusing those names here would be a permanent
--     source of the wrong join.
--   * A cycle can be rebuilt, re-seeded or dropped without a single
--     statement touching live clipping data.
--
-- Identity IS shared: `auth.users` stays the one login, so a clipper who
-- enters a Clipathon signs in with the account they already have. What
-- is not shared is the profile, the roles or the money.
-- =============================================================

create schema if not exists clipathon;

comment on schema clipathon is
  'Clipathon event platform. Separate from the clipping product in public. Managed by its own admin console.';

-- Extensions used below. Both are already present on Supabase, this is
-- only here so the file runs on a bare Postgres too.
create extension if not exists pgcrypto;
create extension if not exists citext;

-- -------------------------------------------------------------
-- Enumerated types
-- -------------------------------------------------------------
-- Statuses are enums rather than free text. `public.clip_submissions`
-- uses `text` with a default of 'pending' and nothing stops a typo
-- becoming a new status forever; that is the mistake not to repeat on a
-- table that decides who gets prize money.

-- The cycle clock. Matches the countdown in the operations playbook,
-- Day 10 through Day 0, and drives every lock in the creator dashboard.
create type clipathon.cycle_status as enum (
  'draft',            -- being set up, invisible to creators
  'registration',     -- Day 10 to Day 5
  'reveal',           -- Day 5 to Day 4, briefs live, sessions running
  'slot_selection',   -- Day 4, the window is open
  'creation',         -- Day 3 to Day 1, the 72 hour clock
  'tracking',         -- Day 1 to Day 0, snapshots and scoring
  'finale',           -- Day 0
  'closed',           -- results locked and published
  'archived'          -- historical, read only
);

create type clipathon.registration_status as enum (
  'pending',          -- in the verification queue
  'needs_info',       -- profile private or link broken, 24h to fix
  'approved',         -- on the roster, dashboard unlocked
  'rejected',         -- fake, duplicate, or brand safety risk
  'withdrawn'         -- creator pulled out
);

create type clipathon.account_platform as enum ('instagram','youtube','tiktok');

create type clipathon.account_status as enum (
  'pending',          -- code issued, waiting on the bio check
  'verified',
  'failed',           -- code never appeared
  'removed'
);

-- The submission ladder the creator sees on the campaign card, in order.
create type clipathon.submission_status as enum (
  'not_started',
  'link_submitted',
  'file_uploaded',
  'complete',         -- both paths in
  'under_review',     -- QC has it
  'verified',         -- counts toward results
  'rejected',         -- fixable, creator may resubmit inside the window
  'disqualified'      -- terminal
);

create type clipathon.dq_reason as enum (
  'late',
  'incomplete',
  'taken_down',
  'brand_non_compliant',
  'artificial_engagement',
  'not_original',
  'wrong_brand',
  'other'
);

-- Where a point came from. The leaderboard is a sum over the ledger, so
-- this column is what lets the admin console answer "why do they have
-- 2,400 points" without guessing.
create type clipathon.points_source as enum (
  'task',             -- bonus task completion
  'referral',         -- an approved referral
  'result',           -- Clipathon placement or reach
  'streak',           -- consecutive cycle participation
  'adjustment'        -- manual, always with a reason and an actor
);

-- A referral only pays at 'approved'. Everything before it is pipeline,
-- and 'rejected' is terminal and pays nothing. Enforced by trigger in 009.
create type clipathon.referral_stage as enum (
  'invited',
  'verified',
  'submitted',
  'approved',
  'rejected'
);

create type clipathon.task_category as enum ('setup','learn','create','community');

create type clipathon.session_kind as enum (
  'rules','brand_deep_dive','workshop','walkthrough','other'
);

create type clipathon.announcement_kind as enum ('session','deadline','notice');

create type clipathon.ticket_category as enum (
  'verification','slot','technical','submission','brand','payout','other'
);

create type clipathon.ticket_priority as enum ('critical','high','normal','low');

create type clipathon.ticket_status as enum (
  'open','in_progress','waiting_on_creator','resolved','closed'
);

-- Console roles. Deliberately finer than public.admin_users, which is a
-- flat "you are an admin" list. Here a reviewer can clear the
-- verification queue without being able to touch the prize pool.
create type clipathon.admin_role as enum (
  'owner',            -- everything, including sign off and payouts
  'ops',              -- cycle clock, slots, QC, scoring
  'reviewer',         -- registration and account verification queue only
  'partnerships',     -- brands, briefs, assets, sessions
  'marketing',        -- announcements, ambassadors, acquisition
  'finance',          -- prize pool and payouts only
  'readonly'
);

create type clipathon.prize_kind as enum ('overall','brand','special','season');

create type clipathon.payout_status as enum ('pending','approved','sent','failed','cancelled');

create type clipathon.certificate_kind as enum ('participation','winner');

-- -------------------------------------------------------------
-- Console operators
-- -------------------------------------------------------------
-- Separate from public.admin_users on purpose. Somebody running the
-- Clipathon is not automatically an admin of the clipping platform, and
-- vice versa. Grant twice if a person genuinely needs both.
create table clipathon.admin_users (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       citext not null,
  full_name   text,
  role        clipathon.admin_role not null default 'readonly',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id),
  constraint admin_users_user_unique unique (user_id)
);

comment on table clipathon.admin_users is
  'Operators of the Clipathon admin console. Intentionally separate from public.admin_users.';

create index admin_users_role_idx on clipathon.admin_users (role) where is_active;

-- -------------------------------------------------------------
-- Helper functions used by every RLS policy in 008
-- -------------------------------------------------------------
-- SECURITY DEFINER and a pinned search_path: without the pin, a caller
-- who can create objects in their own schema could shadow `admin_users`
-- and grant themselves whatever this function returns.

create or replace function clipathon.is_admin()
returns boolean
language sql
stable
security definer
set search_path = clipathon, pg_temp
as $$
  select exists (
    select 1 from clipathon.admin_users a
    where a.user_id = auth.uid() and a.is_active
  );
$$;

create or replace function clipathon.has_role(roles clipathon.admin_role[])
returns boolean
language sql
stable
security definer
set search_path = clipathon, pg_temp
as $$
  select exists (
    select 1 from clipathon.admin_users a
    where a.user_id = auth.uid()
      and a.is_active
      and (a.role = 'owner' or a.role = any(roles))
  );
$$;

comment on function clipathon.has_role is
  'True when the caller holds any of the listed console roles. owner always passes.';

-- Touch trigger, attached to every table with updated_at in 009.
create or replace function clipathon.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------
-- USAGE on the schema only. Table access is decided by RLS in 008, not
-- by grants, so a missing policy fails closed rather than leaking.
grant usage on schema clipathon to authenticated, service_role;
revoke all on schema clipathon from anon;

alter default privileges in schema clipathon
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema clipathon
  grant all on tables to service_role;
alter default privileges in schema clipathon
  grant usage, select on sequences to authenticated, service_role;
