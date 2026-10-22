-- =============================================================
-- CLIPATHON · 006 · prizes, certificates, payouts, support, audit
-- =============================================================

-- -------------------------------------------------------------
-- prizes
-- -------------------------------------------------------------
-- The pool split, published before registration opens and never revised
-- after results are known. Rows are the tiers, not the winners: 1st,
-- 2nd, 3rd, 4th to 10th, 11th to 50th, per-brand, special categories.
create table clipathon.prizes (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  kind            clipathon.prize_kind not null default 'overall',
  brand_id        uuid references clipathon.brands (id) on delete cascade,  -- set for per-brand tiers

  label           text not null,                  -- 'Champion', '4th to 10th'
  rank_from       integer,
  rank_to         integer,
  cash_minor      bigint not null default 0,      -- paise
  non_cash        text,                           -- 'Cash and gift hamper'
  seats           integer,                        -- how many people this tier pays
  sort_order      smallint not null default 0,

  published_at    timestamptz,                    -- once set, 009 blocks edits
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint prizes_cash_nonneg check (cash_minor >= 0),
  constraint prizes_rank_order check (
    rank_from is null or rank_to is null or rank_from <= rank_to
  ),
  constraint prizes_brand_shape check (
    (kind = 'brand' and brand_id is not null) or (kind <> 'brand')
  )
);

comment on column clipathon.prizes.published_at is
  'Set when the split goes public. 009 then refuses any change: the pool is never revised after results are known.';

create index prizes_cycle_idx on clipathon.prizes (cycle_id, sort_order);

-- Who actually won what. Written after the two-person sign off.
create table clipathon.prize_awards (
  id              uuid primary key default gen_random_uuid(),
  prize_id        uuid not null references clipathon.prizes (id) on delete restrict,
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  creator_id      uuid not null references clipathon.creators (id) on delete restrict,
  submission_id   uuid references clipathon.submissions (id) on delete set null,
  season_id       uuid references clipathon.seasons (id) on delete set null,  -- for season prizes

  final_rank      integer,
  cash_minor      bigint not null default 0,
  non_cash        text,
  announced_at    timestamptz,
  created_at      timestamptz not null default now(),

  constraint awards_unique unique (prize_id, creator_id),
  constraint awards_cash_nonneg check (cash_minor >= 0)
);

create index awards_cycle_idx   on clipathon.prize_awards (cycle_id);
create index awards_creator_idx on clipathon.prize_awards (creator_id);

-- -------------------------------------------------------------
-- certificates
-- -------------------------------------------------------------
-- Every creator with a valid entry gets a participation certificate;
-- winners get a distinct one. Both stay permanently downloadable from
-- the dashboard, so this table is never pruned.
create table clipathon.certificates (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  creator_id      uuid not null references clipathon.creators (id) on delete cascade,
  kind            clipathon.certificate_kind not null default 'participation',
  serial          text not null,
  file_url        text,
  issued_at       timestamptz not null default now(),

  constraint certificates_serial_unique unique (serial),
  constraint certificates_one_per_kind unique (cycle_id, creator_id, kind)
);

create index certificates_creator_idx on clipathon.certificates (creator_id);

-- -------------------------------------------------------------
-- payouts
-- -------------------------------------------------------------
-- Prize money only. This has nothing to do with clipper RPM earnings
-- and shares no table with them: different money, different approval
-- chain, different console.
--
-- Bank details are collected from winners at the venue or through the
-- dashboard, which is why they are nullable until the award exists.
create table clipathon.payouts (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid not null references clipathon.cycles (id) on delete cascade,
  creator_id      uuid not null references clipathon.creators (id) on delete restrict,
  award_id        uuid references clipathon.prize_awards (id) on delete set null,

  amount_minor    bigint not null,
  currency        char(3) not null default 'INR',
  method          text,                           -- 'upi' | 'bank'
  upi_id          text,
  account_name    text,
  account_last4   char(4),                        -- never the full number
  ifsc            text,

  status          clipathon.payout_status not null default 'pending',
  promised_by     timestamptz,                    -- the timeline stated on stage
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz,
  sent_at         timestamptz,
  reference       text,                           -- bank or UPI reference
  failure_reason  text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint payouts_amount_positive check (amount_minor > 0),
  constraint payouts_sent_shape check (status <> 'sent' or (sent_at is not null and reference is not null))
);

comment on column clipathon.payouts.account_last4 is
  'Last four digits only. Full account numbers are never stored in this schema.';

create index payouts_cycle_idx  on clipathon.payouts (cycle_id, status);
create index payouts_creator_idx on clipathon.payouts (creator_id);

-- -------------------------------------------------------------
-- support
-- -------------------------------------------------------------
-- Categorised tickets with a reference number and a reply thread, and
-- an SLA target derived from the priority rather than typed in.
create table clipathon.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  cycle_id        uuid references clipathon.cycles (id) on delete set null,
  creator_id      uuid not null references clipathon.creators (id) on delete cascade,
  reference       text not null,                  -- 'CLP-1042', shown to the creator

  category        clipathon.ticket_category not null default 'other',
  priority        clipathon.ticket_priority not null default 'normal',
  status          clipathon.ticket_status not null default 'open',
  subject         text not null,
  body            text not null,

  -- First response target, set from priority by the trigger in 009:
  -- critical 15 min, high 1 hour, normal 4 hours, low 24 hours.
  sla_due_at      timestamptz,
  first_response_at timestamptz,
  assigned_to     uuid references auth.users (id) on delete set null,
  resolved_at     timestamptz,
  escalated_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint tickets_reference_unique unique (reference)
);

create index tickets_queue_idx   on clipathon.support_tickets (status, priority, created_at)
  where status in ('open','in_progress');
create index tickets_creator_idx on clipathon.support_tickets (creator_id, created_at desc);
create index tickets_breach_idx  on clipathon.support_tickets (sla_due_at)
  where first_response_at is null;

create table clipathon.ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references clipathon.support_tickets (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  is_staff    boolean not null default false,
  body        text not null,
  is_internal boolean not null default false,     -- staff note, hidden from the creator
  created_at  timestamptz not null default now()
);

create index ticket_messages_idx on clipathon.ticket_messages (ticket_id, created_at);

-- -------------------------------------------------------------
-- audit_log
-- -------------------------------------------------------------
-- Clipathon's own trail, separate from public.audit_logs. Anything
-- consequential in the admin console writes here: verification
-- outcomes, slot changes, QC decisions, score locks, prize edits,
-- payout approvals.
create table clipathon.audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users (id) on delete set null,
  actor_email   text,
  action        text not null,
  target_table  text,
  target_id     text,
  cycle_id      uuid references clipathon.cycles (id) on delete set null,
  old_data      jsonb,
  new_data      jsonb,
  created_at    timestamptz not null default now()
);

create index audit_log_created_idx on clipathon.audit_log (created_at desc);
create index audit_log_target_idx  on clipathon.audit_log (target_table, target_id);
create index audit_log_actor_idx   on clipathon.audit_log (actor_id, created_at desc);
