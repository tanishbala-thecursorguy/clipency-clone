-- =============================================================
-- CLIPATHON · 004 · slot allocation, submissions, metric snapshots
-- =============================================================

-- -------------------------------------------------------------
-- slots
-- -------------------------------------------------------------
-- Slot selection is the highest traffic moment on the platform: 500
-- creators hitting five counters in the same few minutes. Two rules
-- have to survive that, and neither can be left to the application:
--
--   1. One brand per creator per cycle, final once confirmed.
--   2. A brand at capacity cannot be oversold.
--
-- (1) is the unique constraint below. (2) is the trigger in 009, which
-- locks the brand row before incrementing, so two simultaneous
-- selections serialise instead of both reading 99 and both writing 100.
create table clipathon.slots (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  registration_id uuid not null references clipathon.registrations (id) on delete cascade,
  brand_id        uuid not null references clipathon.brands (id) on delete restrict,

  auto_assigned   boolean not null default false,   -- did not choose before the window shut
  selected_at     timestamptz not null default now(),

  -- Change requests: support only, inside two hours of the window
  -- opening, and only if the target brand still has room. Recording the
  -- previous brand keeps the trail.
  changed_from    uuid references clipathon.brands (id) on delete set null,
  changed_at      timestamptz,
  changed_by      uuid references auth.users (id) on delete set null,
  change_reason   text,

  created_at      timestamptz not null default now(),

  -- One slot per creator per cycle. This is the "selection is final" rule.
  constraint slots_one_per_registration unique (registration_id),
  constraint slots_change_shape check (
    (changed_from is null and changed_at is null) or (changed_from is not null and changed_at is not null)
  )
);

comment on table clipathon.slots is
  'Brand allocation. One row per creator per cycle; capacity is enforced by the trigger in 009 under row lock.';

create index slots_brand_idx on clipathon.slots (brand_id);
create index slots_cycle_idx on clipathon.slots (cycle_id, selected_at);

-- -------------------------------------------------------------
-- submissions
-- -------------------------------------------------------------
-- Two mandatory paths: the live post link, and the raw file. Missing
-- either makes the entry incomplete, which is why both are plain
-- nullable columns and completeness is a generated expression rather
-- than a flag somebody has to remember to set.
create table clipathon.submissions (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  registration_id uuid not null references clipathon.registrations (id) on delete cascade,
  brand_id        uuid not null references clipathon.brands (id) on delete restrict,
  slot_id         uuid references clipathon.slots (id) on delete set null,

  -- Path A: the published post.
  post_url        text,
  platform        clipathon.account_platform,
  platform_post_id text,
  posted_at       timestamptz,                     -- when the creator published
  link_submitted_at timestamptz,
  link_valid      boolean,                         -- resolvable, public, right platform
  link_checked_at timestamptz,
  link_error      text,

  -- Path B: the raw file, mirrored into the brand's Drive folder.
  file_name       text,
  file_bytes      bigint,
  file_mime       text,
  drive_file_id   text,
  drive_url       text,
  file_uploaded_at timestamptz,

  -- Both in?
  is_complete     boolean generated always as (
    post_url is not null and drive_url is not null
  ) stored,

  status          clipathon.submission_status not null default 'not_started',

  -- QC. `qc_note` is what the creator sees on the campaign card with
  -- the time remaining to fix it.
  qc_note         text,
  qc_by           uuid references auth.users (id) on delete set null,
  qc_at           timestamptz,
  compliance_score numeric(5,2),                   -- 0 to 100, manual
  quality_score    numeric(5,2),                   -- 0 to 100, manual
  scored_by       uuid references auth.users (id) on delete set null,
  scored_at       timestamptz,

  dq_reason       clipathon.dq_reason,
  dq_note         text,
  dq_at           timestamptz,

  -- Set when the clip counts. This is the moment that pays any referral
  -- pointing at this creator, via the trigger in 009.
  approved_at     timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One entry per creator per cycle. They create for one brand only.
  constraint submissions_one_per_registration unique (registration_id),
  constraint submissions_scores_range check (
    (compliance_score is null or compliance_score between 0 and 100)
    and (quality_score is null or quality_score between 0 and 100)
  ),
  constraint submissions_dq_shape check (
    (status <> 'disqualified') or (dq_reason is not null and dq_at is not null)
  ),
  -- 'verified' is the state that feeds results, so it may not be
  -- reached without both paths present.
  constraint submissions_verified_needs_both check (
    status <> 'verified' or is_complete
  ),
  constraint submissions_approved_shape check (
    (approved_at is null) or status = 'verified'
  )
);

comment on column clipathon.submissions.is_complete is
  'Generated. Both the live link and the raw file are mandatory; this is the single definition of complete.';
comment on column clipathon.submissions.approved_at is
  'Set only when status reaches verified. Referral payouts key off this timestamp.';

create index submissions_cycle_idx  on clipathon.submissions (cycle_id, status);
create index submissions_brand_idx  on clipathon.submissions (brand_id, status);
create index submissions_queue_idx  on clipathon.submissions (cycle_id, created_at)
  where status in ('complete','under_review');
create unique index submissions_post_unique_idx on clipathon.submissions (cycle_id, post_url)
  where post_url is not null;

-- -------------------------------------------------------------
-- metric_snapshots
-- -------------------------------------------------------------
-- The playbook is specific: metrics are captured at fixed snapshot
-- points, not continuously, so every creator is measured over a
-- comparable window, and each snapshot is archived with a screenshot so
-- any result can be defended after the fact.
--
-- Rows here are append only. 009 blocks UPDATE and DELETE outright,
-- because an editable snapshot table is not evidence.
create table clipathon.metric_snapshots (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references clipathon.submissions (id) on delete cascade,
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,

  snapshot_no     smallint not null,               -- 1 = cutoff, 2 = mid, 3 = final
  is_final        boolean not null default false,
  captured_at     timestamptz not null default now(),

  views           bigint not null default 0,
  likes           bigint not null default 0,
  comments        bigint not null default 0,
  shares          bigint not null default 0,
  saves           bigint not null default 0,

  -- Interactions over views. Normalises for audience size, which is
  -- what protects smaller creators in the composite score.
  engagement_rate numeric(7,4) generated always as (
    case when views > 0
      then ((likes + comments + shares + saves)::numeric / views::numeric)
      else 0 end
  ) stored,

  screenshot_url  text,                            -- the archive
  raw             jsonb not null default '{}'::jsonb,
  captured_by     uuid references auth.users (id) on delete set null,
  source          text not null default 'api',     -- 'api' | 'manual'

  constraint snapshots_unique unique (submission_id, snapshot_no),
  constraint snapshots_no_positive check (snapshot_no > 0),
  constraint snapshots_counts_nonneg check (
    views >= 0 and likes >= 0 and comments >= 0 and shares >= 0 and saves >= 0
  )
);

comment on table clipathon.metric_snapshots is
  'Append only. 009 revokes update and delete: a snapshot that can be edited is not evidence.';

create index snapshots_submission_idx on clipathon.metric_snapshots (submission_id, snapshot_no);
create index snapshots_cycle_idx on clipathon.metric_snapshots (cycle_id, captured_at desc);
-- One final snapshot per submission, and it is the one scoring reads.
create unique index snapshots_one_final_idx
  on clipathon.metric_snapshots (submission_id) where is_final;
