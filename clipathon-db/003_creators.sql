-- =============================================================
-- CLIPATHON · 003 · creators, registrations, accounts, referrals
-- =============================================================
-- Nothing in this file references a clipping table. `public.profiles`
-- and `public.connected_accounts` are deliberately NOT reused:
--
--   * public.profiles is a clipper/client profile with client_access,
--     payout wiring and a role column that means something else here.
--   * public.connected_accounts carries OAuth tokens for metrics
--     polling. Clipathon verification only needs a bio code, so
--     borrowing that table would drag token storage and its RLS into an
--     event product that has no use for either.
--
-- The one thing shared is the LOGIN, auth.users, which is Supabase's own
-- table rather than a clipping one. Even that is nullable: a creator
-- registers through a form before any account exists, and auth_user_id
-- is filled in when they first sign in.
-- =============================================================

-- -------------------------------------------------------------
-- creators
-- -------------------------------------------------------------
-- The PERSON, one row, reused across every cycle they enter. Lifetime
-- aggregates live here; anything cycle-specific belongs on the
-- registration below. This split is what makes "3 Clipathons, best rank
-- #4" answerable without scanning history.
create table clipathon.creators (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid references auth.users (id) on delete set null,

  creator_code      text not null,                -- 'CLP-7662', shown on the dashboard
  full_name         text not null,                -- as it appears on the certificate
  display_name      text,                         -- what the leaderboard shows
  email             citext not null,
  phone             text not null,
  phone_verified_at timestamptz,                  -- OTP at signup
  email_verified_at timestamptz,

  city              text,
  campus            text,                         -- college or institution
  country           text not null default 'India',

  -- Their own code, which other people enter at signup.
  referral_code     text not null,

  is_blocked        boolean not null default false,
  blocked_reason    text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint creators_code_unique     unique (creator_code),
  constraint creators_referral_unique unique (referral_code),
  constraint creators_email_unique    unique (email),
  constraint creators_phone_unique    unique (phone),
  constraint creators_auth_unique     unique (auth_user_id)
);

comment on table clipathon.creators is
  'A person across all cycles. Cycle-specific state lives on registrations.';
comment on column clipathon.creators.auth_user_id is
  'Nullable on purpose: registration happens before the account exists. Linked at first sign in.';

create index creators_city_idx  on clipathon.creators (city);
create index creators_email_idx on clipathon.creators (email);

-- -------------------------------------------------------------
-- ambassadors
-- -------------------------------------------------------------
-- Campus ambassador program. Payouts are calculated only on
-- registrations that pass verification, never on raw signups, which is
-- what the `attributed_verified` view in 007 counts.
create table clipathon.ambassadors (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references clipathon.cycles (id) on delete cascade,
  creator_id    uuid references clipathon.creators (id) on delete set null,
  full_name     text not null,
  email         citext not null,
  phone         text,
  campus        text not null,
  ref_code      text not null,                    -- hidden field on the signup form
  reward_note   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint ambassadors_code_unique unique (ref_code)
);

create index ambassadors_cycle_idx on clipathon.ambassadors (cycle_id, campus);

-- -------------------------------------------------------------
-- registrations
-- -------------------------------------------------------------
-- One creator entering one cycle. This is where the verification
-- outcome lives, because a creator approved in Cycle 01 still gets
-- re-checked in Cycle 02: accounts go private, follower bands change.
create table clipathon.registrations (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references clipathon.cycles (id) on delete cascade,
  creator_id        uuid not null references clipathon.creators (id) on delete cascade,

  -- Declared at signup, cross checked at verification.
  primary_profile_url  text not null,
  secondary_profile_url text,
  follower_band     text,                         -- '10K to 50K'
  content_categories text[] not null default '{}',

  -- Attribution, captured from the hidden field on the form.
  ref_code_used     text,
  ambassador_id     uuid references clipathon.ambassadors (id) on delete set null,
  referred_by       uuid references clipathon.creators (id) on delete set null,

  -- Rights consent. The one-year brand licence is sold on this, so the
  -- exact text accepted is archived per creator, not just a boolean.
  terms_accepted_at timestamptz not null default now(),
  terms_version     text not null default 'v1',

  status            clipathon.registration_status not null default 'pending',
  review_notes      text,
  needs_info_reason text,
  needs_info_until  timestamptz,                  -- 24h window before the record lapses
  reviewed_by       uuid references auth.users (id) on delete set null,
  reviewed_at       timestamptz,
  rejected_reason   text,
  appealed_at       timestamptz,                  -- one appeal allowed, via support

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A creator enters a cycle once.
  constraint registrations_unique unique (cycle_id, creator_id),
  -- You cannot refer yourself.
  constraint registrations_no_self_referral check (referred_by is null or referred_by <> creator_id),
  constraint registrations_reviewed_shape check (
    (status in ('pending','withdrawn')) or reviewed_at is not null
  )
);

comment on column clipathon.registrations.terms_version is
  'Which consent text was accepted. Needed to defend the one-year usage licence per creator.';

create index registrations_queue_idx on clipathon.registrations (cycle_id, status, created_at)
  where status in ('pending','needs_info');
create index registrations_creator_idx on clipathon.registrations (creator_id);
create index registrations_amb_idx on clipathon.registrations (ambassador_id) where ambassador_id is not null;
create index registrations_referrer_idx on clipathon.registrations (referred_by) where referred_by is not null;

-- -------------------------------------------------------------
-- creator_accounts
-- -------------------------------------------------------------
-- Bio-code verification, the flow the dashboard already implements. No
-- OAuth, no tokens: the creator pastes a code into their bio and we
-- read the public profile. That is all a Clipathon needs, and it means
-- this table holds nothing worth stealing.
create table clipathon.creator_accounts (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references clipathon.creators (id) on delete cascade,
  platform          clipathon.account_platform not null,
  handle            text not null,
  profile_url       text,

  status            clipathon.account_status not null default 'pending',
  verification_code text,
  code_expires_at   timestamptz,
  verify_attempts   smallint not null default 0,
  last_verify_at    timestamptz,
  verify_error      text,
  verified_at       timestamptz,

  is_primary        boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- The same handle cannot be claimed twice on the same platform, by
  -- anyone. This is the duplicate-account check from the playbook,
  -- enforced rather than left to the reviewer's memory.
  constraint creator_accounts_handle_unique unique (platform, handle),
  constraint creator_accounts_attempts check (verify_attempts >= 0)
);

create index creator_accounts_creator_idx on clipathon.creator_accounts (creator_id, platform);
-- Exactly one primary handle per creator.
create unique index creator_accounts_one_primary_idx
  on clipathon.creator_accounts (creator_id) where is_primary;

-- -------------------------------------------------------------
-- referrals
-- -------------------------------------------------------------
-- The rule the product enforces: a referral is worth points only once
-- the creator it brought in gets a clip APPROVED. Signups and even
-- verified accounts pay nothing.
--
-- This table is the pipeline. The stage is advanced by triggers in 009
-- as the referred creator moves through the funnel, and only the move
-- into 'approved' writes to the points ledger. Storing the stage rather
-- than deriving it keeps a permanent record of referrals that reached
-- 'submitted' and then died at QC, which is what the funnel on the
-- dashboard shows.
create table clipathon.referrals (
  id                    uuid primary key default gen_random_uuid(),
  cycle_id              uuid not null references clipathon.cycles (id) on delete cascade,
  referrer_id           uuid not null references clipathon.creators (id) on delete cascade,
  referred_creator_id   uuid not null references clipathon.creators (id) on delete cascade,
  registration_id       uuid references clipathon.registrations (id) on delete set null,

  stage                 clipathon.referral_stage not null default 'invited',
  stage_changed_at      timestamptz not null default now(),

  -- The submission whose approval paid this out. Non-null only at
  -- 'approved', and it is what an auditor follows to check the payment.
  qualifying_submission_id uuid,

  points_awarded        integer not null default 0,
  points_awarded_at     timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint referrals_unique unique (cycle_id, referred_creator_id),
  constraint referrals_no_self check (referrer_id <> referred_creator_id),
  -- Points may only exist on an approved referral. The core rule,
  -- written as a constraint so no code path can pay early.
  constraint referrals_paid_only_when_approved check (
    (points_awarded = 0 and points_awarded_at is null)
    or (stage = 'approved' and qualifying_submission_id is not null and points_awarded_at is not null)
  )
);

comment on constraint referrals_paid_only_when_approved on clipathon.referrals is
  'A referral pays only at stage approved, and only with the approved submission recorded. Enforced here, not just in the UI.';

create index referrals_referrer_idx on clipathon.referrals (referrer_id, cycle_id);
create index referrals_stage_idx    on clipathon.referrals (cycle_id, stage);
create index referrals_referred_idx on clipathon.referrals (referred_creator_id);
