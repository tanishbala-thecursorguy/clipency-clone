-- =============================================================
-- CLIPATHON · 002 · cycles, brands, sessions, announcements
-- =============================================================
-- The cycle is the root object. Every other row in this schema hangs off
-- one, which is what makes the whole thing repeatable every quarter:
-- create a cycle, and the countdown, the slot maths, the leaderboard
-- scope and the archive boundaries all follow from its dates.
-- =============================================================

-- -------------------------------------------------------------
-- cycles
-- -------------------------------------------------------------
-- The operations playbook is explicit that the timeline is relative:
-- pick the finale date, count back ten days. So the only date that has
-- to be entered is `registration_closes` (Day 5), and every other
-- moment is derived from it by the trigger in 009. Real columns rather
-- than a view because the admin console needs to sort and index on them.
create table clipathon.cycles (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,                    -- 'cycle-01'
  name                  text not null,                    -- 'Cycle 01'
  city                  text not null default 'Bangalore',
  status                clipathon.cycle_status not null default 'draft',

  -- Day 5. The single anchor. Moving this moves the entire cycle.
  registration_closes   timestamptz not null,

  -- Derived clock. Kept in the row so the admin console, the cron jobs
  -- and the dashboard all read the same numbers, and so these are
  -- sortable and indexable.
  --
  -- These are maintained by derive_cycle_clock() in 009 rather than
  -- being GENERATED columns: adding an interval to a timestamptz is
  -- STABLE, not IMMUTABLE, because day and month arithmetic depends on
  -- the session TimeZone, and Postgres rejects a stable expression in a
  -- generated column. The trigger gives the same guarantee, that these
  -- are never written by hand, without that restriction.
  registration_opens    timestamptz,
  brands_reveal_at      timestamptz,
  slots_open_at         timestamptz,
  slots_close_at        timestamptz,
  -- The 72 hour clock starts when the slot window shuts, not at a
  -- wall-clock hour. That is what the playbook specifies.
  submission_cutoff_at  timestamptz,
  finale_at             timestamptz,

  -- Capacity. 5 x 100 = 500 for Cycle 01. Held as numbers so a cycle
  -- that lands short can shrink slots_per_brand proportionally rather
  -- than leaving one brand under-filled.
  brand_count           smallint not null default 5,
  slots_per_brand       smallint not null default 100,
  total_slots           integer generated always as (brand_count::integer * slots_per_brand::integer) stored,

  -- Prize pool and the scoring model, both published before
  -- registration opens and frozen after. `scoring_locked_at` is the
  -- guard: once set, 009 refuses to change the weights.
  prize_pool_minor      bigint not null default 15000000,  -- paise. 15000000 = INR 1,50,000
  currency              char(3) not null default 'INR',
  scoring_weights       jsonb not null default
    '{"views":40,"engagement":25,"quality":20,"compliance":15}'::jsonb,
  scoring_locked_at     timestamptz,

  -- Publication window for the final metric snapshot, announced to
  -- creators in advance and identical for everyone.
  final_snapshot_at     timestamptz,

  venue                 text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id),

  constraint cycles_code_unique unique (code),
  constraint cycles_slots_positive check (brand_count > 0 and slots_per_brand > 0),
  constraint cycles_pool_positive check (prize_pool_minor >= 0),
  -- The four weights must add to 100 or the composite score is meaningless.
  constraint cycles_weights_sum check (
    coalesce((scoring_weights->>'views')::numeric,0)
  + coalesce((scoring_weights->>'engagement')::numeric,0)
  + coalesce((scoring_weights->>'quality')::numeric,0)
  + coalesce((scoring_weights->>'compliance')::numeric,0) = 100
  )
);

comment on table clipathon.cycles is
  'One Clipathon. registration_closes is the only date entered; the rest of the clock is generated from it.';
comment on column clipathon.cycles.prize_pool_minor is
  'Minor units (paise). Money is never stored as float anywhere in this schema.';
comment on column clipathon.cycles.scoring_locked_at is
  'Set when the model is published. After this, 009 blocks any change to scoring_weights.';

create index cycles_status_idx on clipathon.cycles (status);
create index cycles_finale_idx on clipathon.cycles (finale_at desc);

-- Only one cycle may be live at a time. Two overlapping cycles would
-- make "the countdown" ambiguous everywhere it is displayed.
create unique index cycles_one_live_idx on clipathon.cycles ((status is not null))
  where status in ('registration','reveal','slot_selection','creation','tracking','finale');

-- -------------------------------------------------------------
-- brands
-- -------------------------------------------------------------
-- A brand campaign inside one cycle. slots_taken is a real column
-- rather than a count(*) because slot selection is the highest traffic
-- moment on the platform and the counter is read far more often than it
-- is written. 009 keeps it exact under concurrency.
create table clipathon.brands (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references clipathon.cycles (id) on delete cascade,
  slug              text not null,                       -- 'orbit'
  name              text not null,                       -- 'Orbit Audio'
  category          text,                                -- 'Consumer tech'
  logo_url          text,
  summary           text,                                -- one line on the card
  brief             text,                                -- the full brief
  must_include      text[] not null default '{}',        -- mandatory talking points
  never_say         text[] not null default '{}',        -- the do-not-say list
  hashtags          text[] not null default '{}',
  mentions          text[] not null default '{}',
  disclosure_text   text,
  content_style     text,
  duration_min_sec  smallint,
  duration_max_sec  smallint,
  reward_note       text,                                -- product kit, subscription, etc
  drive_folder      text,                                -- root for raw file uploads

  slots_total       smallint not null,
  slots_taken       smallint not null default 0,
  display_order     smallint not null default 0,
  is_reserve        boolean not null default false,      -- the backup brand, hidden unless needed

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint brands_slug_unique unique (cycle_id, slug),
  constraint brands_name_unique unique (cycle_id, name),
  constraint brands_slots_sane check (slots_taken between 0 and slots_total),
  constraint brands_duration_sane check (
    duration_min_sec is null or duration_max_sec is null or duration_min_sec <= duration_max_sec
  )
);

comment on column clipathon.brands.slots_taken is
  'Denormalised counter. Kept exact by the trigger in 009, which locks the brand row before allocating.';

create index brands_cycle_idx on clipathon.brands (cycle_id, display_order);

-- Reference material attached to a brief: sample creatives, product
-- footage, top performing reference reels.
create table clipathon.brand_assets (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references clipathon.brands (id) on delete cascade,
  label       text not null,
  url         text not null,
  kind        text,                                      -- 'creative' | 'footage' | 'reference' | 'logo'
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

create index brand_assets_brand_idx on clipathon.brand_assets (brand_id, sort_order);

-- -------------------------------------------------------------
-- sessions
-- -------------------------------------------------------------
-- Education sessions between the reveal and the slot window. Every one
-- is recorded and posted within two hours, so `recording_url` is part
-- of the row from the start rather than bolted on later.
create table clipathon.sessions (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references clipathon.cycles (id) on delete cascade,
  brand_id      uuid references clipathon.brands (id) on delete set null,  -- set for deep dives
  kind          clipathon.session_kind not null default 'other',
  title         text not null,
  agenda        text,
  host          text,
  starts_at     timestamptz not null,
  duration_min  smallint not null default 60,
  join_url      text,
  recording_url text,
  recorded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sessions_duration_positive check (duration_min > 0)
);

create index sessions_cycle_idx on clipathon.sessions (cycle_id, starts_at);

-- -------------------------------------------------------------
-- announcements
-- -------------------------------------------------------------
-- The 24 hour rule from the playbook is a system behaviour, not a
-- manual task. `publish_at` and `notify_t24_at` default to derived
-- times so nobody has to remember, and the check constraint refuses a
-- row that would announce a session with less than a day of notice.
create table clipathon.announcements (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  session_id      uuid references clipathon.sessions (id) on delete cascade,
  kind            clipathon.announcement_kind not null default 'notice',
  title           text not null,
  body            text,
  event_at        timestamptz,                           -- what it counts down to
  publish_at      timestamptz not null default now(),    -- when it appears in the feed
  is_pinned       boolean not null default false,
  is_critical     boolean not null default false,

  -- Notification engine bookkeeping. Nulls mean "not sent yet"; a cron
  -- job claims rows by stamping these.
  notify_t24_at   timestamptz,
  notify_t24_sent timestamptz,
  notify_t1_at    timestamptz,
  notify_t1_sent  timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id),

  -- A dated announcement has to be in the feed at least 24 hours ahead.
  constraint announcements_24h_rule check (
    event_at is null or publish_at <= event_at - interval '24 hours'
  )
);

comment on constraint announcements_24h_rule on clipathon.announcements is
  'The 24 hour announcement rule, enforced by the database so a late-scheduled session fails loudly instead of quietly.';

create index announcements_feed_idx on clipathon.announcements (cycle_id, publish_at desc);
create index announcements_due_idx  on clipathon.announcements (notify_t24_at)
  where notify_t24_at is not null and notify_t24_sent is null;
create index announcements_due1_idx on clipathon.announcements (notify_t1_at)
  where notify_t1_at is not null and notify_t1_sent is null;
