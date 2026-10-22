-- =============================================================
-- CLIPATHON · 005 · scoring, bonus tasks, points ledger, seasons
-- =============================================================

-- -------------------------------------------------------------
-- scores
-- -------------------------------------------------------------
-- The composite result for one submission. Written by the scoring run
-- at the final snapshot, verified by hand for the top 10 per brand, then
-- signed off by two people and locked.
--
-- The four component scores are stored alongside the total rather than
-- recomputed on read, because the weights can differ per cycle and a
-- historical score has to keep the weighting it was calculated under.
create table clipathon.scores (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references clipathon.cycles (id) on delete cascade,
  submission_id     uuid not null references clipathon.submissions (id) on delete cascade,
  brand_id          uuid not null references clipathon.brands (id) on delete restrict,
  snapshot_id       uuid references clipathon.metric_snapshots (id) on delete set null,

  -- Normalised 0 to 100 within the cycle, before weighting.
  views_score       numeric(6,2) not null default 0,
  engagement_score  numeric(6,2) not null default 0,
  quality_score     numeric(6,2) not null default 0,
  compliance_score  numeric(6,2) not null default 0,

  -- The weights actually applied, copied from the cycle at run time.
  weights_used      jsonb not null,
  total_score       numeric(7,3) not null default 0,

  rank_in_brand     integer,
  rank_overall      integer,

  -- Verification before announcement. Two distinct people, and the
  -- constraint refuses the same person twice.
  verified_by       uuid references auth.users (id) on delete set null,
  verified_at       timestamptz,
  signed_off_by_1   uuid references auth.users (id) on delete set null,
  signed_off_by_2   uuid references auth.users (id) on delete set null,
  locked_at         timestamptz,

  computed_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint scores_one_per_submission unique (submission_id),
  constraint scores_components_range check (
    views_score between 0 and 100 and engagement_score between 0 and 100
    and quality_score between 0 and 100 and compliance_score between 0 and 100
  ),
  constraint scores_two_person_signoff check (
    signed_off_by_1 is null or signed_off_by_2 is null or signed_off_by_1 <> signed_off_by_2
  ),
  -- Locking requires both signatures. No lock, no publication.
  constraint scores_lock_needs_signoff check (
    locked_at is null or (signed_off_by_1 is not null and signed_off_by_2 is not null)
  )
);

comment on constraint scores_two_person_signoff on clipathon.scores is
  'Two distinct people must sign off. The playbook requires it and a self-approved result is not defensible.';

create index scores_cycle_rank_idx on clipathon.scores (cycle_id, rank_overall);
create index scores_brand_rank_idx on clipathon.scores (brand_id, rank_in_brand);

-- -------------------------------------------------------------
-- tasks
-- -------------------------------------------------------------
-- Bonus task catalogue, per cycle so the points can be tuned once real
-- data exists without rewriting history. `is_auto` marks the tasks the
-- platform observes rather than the creator claiming.
create table clipathon.tasks (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references clipathon.cycles (id) on delete cascade,
  code          text not null,                    -- 'verify-handle'
  category      clipathon.task_category not null,
  title         text not null,
  blurb         text,                             -- the one line on the card
  why           text,                             -- why it is worth points
  how_steps     text[] not null default '{}',     -- the numbered steps in the popup
  points        integer not null,

  is_auto       boolean not null default false,   -- observed, not claimed
  unlock_status clipathon.cycle_status,           -- hidden until the cycle reaches this
  target_route  text,                             -- where the popup button sends them
  session_id    uuid references clipathon.sessions (id) on delete set null,
  sort_order    smallint not null default 0,
  is_active     boolean not null default true,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tasks_code_unique unique (cycle_id, code),
  constraint tasks_points_positive check (points > 0)
);

create index tasks_cycle_idx on clipathon.tasks (cycle_id, sort_order) where is_active;

-- One creator finishing one task. The ledger entry is written by the
-- trigger in 009, so a completion row and its points cannot disagree.
create table clipathon.task_completions (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references clipathon.tasks (id) on delete cascade,
  registration_id uuid not null references clipathon.registrations (id) on delete cascade,
  completed_at    timestamptz not null default now(),
  auto_detected   boolean not null default false,

  -- Spot checks. A falsely claimed task is revoked along with its points.
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users (id) on delete set null,
  revoked_reason  text,

  constraint task_completions_unique unique (task_id, registration_id)
);

create index task_completions_reg_idx on clipathon.task_completions (registration_id)
  where revoked_at is null;

-- -------------------------------------------------------------
-- seasons
-- -------------------------------------------------------------
-- The leaderboard runs on a rolling three month season and resets. Past
-- seasons stay readable forever: standings are archived, never deleted.
create table clipathon.seasons (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,                      -- 'season-1'
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  is_current  boolean not null default false,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),

  constraint seasons_code_unique unique (code),
  constraint seasons_dates check (ends_at > starts_at)
);

-- Exactly one current season.
create unique index seasons_one_current_idx on clipathon.seasons ((is_current)) where is_current;

-- Which cycles fall in which season. A season contains one to two.
alter table clipathon.cycles
  add column season_id uuid references clipathon.seasons (id) on delete set null;
create index cycles_season_idx on clipathon.cycles (season_id);

-- -------------------------------------------------------------
-- points_ledger
-- -------------------------------------------------------------
-- The single source of truth for the leaderboard, and the reason there
-- is no `points` integer on any other table.
--
-- Append only, signed amounts. A revoked task writes a negative row
-- rather than deleting the original, so the history of a standing is
-- always reconstructable and an adjustment always has an author and a
-- reason attached. Totals are a sum, exposed through the views in 007.
create table clipathon.points_ledger (
  id              uuid primary key default gen_random_uuid(),
  season_id       uuid not null references clipathon.seasons (id) on delete restrict,
  cycle_id        uuid references clipathon.cycles (id) on delete set null,
  creator_id      uuid not null references clipathon.creators (id) on delete cascade,

  source          clipathon.points_source not null,
  amount          integer not null,               -- signed; negatives are reversals
  reason          text not null,

  -- Exactly one of these points at the thing that caused the entry.
  task_completion_id uuid references clipathon.task_completions (id) on delete set null,
  referral_id     uuid references clipathon.referrals (id) on delete set null,
  submission_id   uuid references clipathon.submissions (id) on delete set null,
  reverses_id     uuid references clipathon.points_ledger (id) on delete set null,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,

  constraint points_amount_nonzero check (amount <> 0),
  -- A manual adjustment must name a human. Automated sources must not.
  constraint points_adjustment_has_actor check (
    source <> 'adjustment' or created_by is not null
  )
);

comment on table clipathon.points_ledger is
  'Append only, signed. Leaderboard totals are sum(amount). Never store a running total anywhere else.';

create index points_creator_idx on clipathon.points_ledger (creator_id, season_id);
create index points_season_idx  on clipathon.points_ledger (season_id, created_at desc);
create index points_cycle_idx   on clipathon.points_ledger (cycle_id) where cycle_id is not null;

-- One ledger row per task completion and per referral, so a retry
-- cannot pay twice.
create unique index points_task_once_idx on clipathon.points_ledger (task_completion_id)
  where task_completion_id is not null and source = 'task';
create unique index points_referral_once_idx on clipathon.points_ledger (referral_id)
  where referral_id is not null and source = 'referral';

-- -------------------------------------------------------------
-- season_standings
-- -------------------------------------------------------------
-- The archive. Live standings come from the view in 007; this table is
-- written once at season close so the historical board is frozen even
-- if a later adjustment touches the ledger.
create table clipathon.season_standings (
  id            uuid primary key default gen_random_uuid(),
  season_id     uuid not null references clipathon.seasons (id) on delete cascade,
  creator_id    uuid not null references clipathon.creators (id) on delete cascade,
  rank          integer not null,
  total_points  integer not null,
  task_points   integer not null default 0,
  referral_points integer not null default 0,
  result_points integer not null default 0,
  cycles_entered smallint not null default 0,
  archived_at   timestamptz not null default now(),

  constraint standings_unique unique (season_id, creator_id),
  constraint standings_rank_positive check (rank > 0)
);

create index standings_season_idx on clipathon.season_standings (season_id, rank);
