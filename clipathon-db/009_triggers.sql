-- =============================================================
-- CLIPATHON · 009 · triggers and business rules
-- =============================================================
-- The rules in this file are the ones that must not depend on the
-- application getting it right: slot capacity under a stampede, a
-- referral paying only on approval, scoring weights frozen once
-- published, snapshots that cannot be edited after the fact.
-- =============================================================

-- -------------------------------------------------------------
-- updated_at everywhere
-- -------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'cycles','brands','sessions','announcements','creators','ambassadors',
    'registrations','creator_accounts','referrals','submissions','scores',
    'tasks','prizes','payouts','support_tickets'
  ]
  loop
    execute format(
      'create trigger %I before update on clipathon.%I
         for each row execute function clipathon.touch_updated_at()',
      'trg_touch_' || t, t
    );
  end loop;
end $$;

-- -------------------------------------------------------------
-- The cycle clock
-- -------------------------------------------------------------
-- Only registration_closes is ever entered. Everything else is derived
-- here, so moving one date moves the whole cycle and no two places can
-- disagree about when the window opens.
--
-- This is a trigger rather than six GENERATED columns because
-- timestamptz + interval is STABLE, not IMMUTABLE: day arithmetic
-- depends on the session TimeZone, and Postgres will not accept a
-- stable expression in a generated column.
create or replace function clipathon.derive_cycle_clock()
returns trigger
language plpgsql
as $$
begin
  new.registration_opens   := new.registration_closes - interval '5 days';
  new.brands_reveal_at     := new.registration_closes;
  new.slots_open_at        := new.registration_closes + interval '1 day';
  new.slots_close_at       := new.registration_closes + interval '1 day 6 hours';
  new.submission_cutoff_at := new.registration_closes + interval '4 days 6 hours';
  new.finale_at            := new.registration_closes + interval '5 days';
  return new;
end;
$$;

create trigger trg_cycle_clock
  before insert or update of registration_closes on clipathon.cycles
  for each row execute function clipathon.derive_cycle_clock();

-- Moving the anchor has to move the schedule with it, or ops re-dates a
-- cycle and every session and deadline silently keeps pointing at the
-- old times. Sessions and announcements shift by the same delta, which
-- also preserves the 24 hour gap the constraint in 002 checks, because
-- event_at and publish_at move together.
create or replace function clipathon.shift_cycle_schedule()
returns trigger
language plpgsql
as $$
declare delta interval;
begin
  delta := new.registration_closes - old.registration_closes;
  if delta = interval '0' then
    return new;
  end if;

  update clipathon.sessions
     set starts_at = starts_at + delta
   where cycle_id = new.id;

  update clipathon.announcements
     set event_at   = event_at + delta,
         publish_at = publish_at + delta
   where cycle_id = new.id
     and event_at is not null;

  return new;
end;
$$;

create trigger trg_shift_schedule
  after update of registration_closes on clipathon.cycles
  for each row execute function clipathon.shift_cycle_schedule();

-- -------------------------------------------------------------
-- Slot capacity, under concurrency
-- -------------------------------------------------------------
-- The failure this prevents: two creators select the last slot at the
-- same moment, both transactions read slots_taken = 99, both write 100,
-- and the brand is oversold by one. SELECT ... FOR UPDATE takes a row
-- lock on the brand so the second transaction waits and then sees 100.
create or replace function clipathon.claim_slot()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  b record;
  cy record;
begin
  select * into b from clipathon.brands where id = new.brand_id for update;
  if not found then
    raise exception 'Brand % does not exist', new.brand_id using errcode = 'foreign_key_violation';
  end if;

  if b.slots_taken >= b.slots_total then
    raise exception 'Brand % is full (% of % slots taken)', b.name, b.slots_taken, b.slots_total
      using errcode = 'check_violation';
  end if;

  select * into cy from clipathon.cycles where id = new.cycle_id;
  if b.cycle_id <> new.cycle_id then
    raise exception 'Brand % belongs to a different cycle', b.name using errcode = 'check_violation';
  end if;

  -- Auto assignment at the close of the window is legitimate outside the
  -- window; a creator choosing is not.
  if not new.auto_assigned and (now() < cy.slots_open_at or now() > cy.slots_close_at) then
    raise exception 'Slot selection is not open for cycle %', cy.name using errcode = 'check_violation';
  end if;

  update clipathon.brands set slots_taken = slots_taken + 1 where id = new.brand_id;
  return new;
end;
$$;

create trigger trg_claim_slot
  before insert on clipathon.slots
  for each row execute function clipathon.claim_slot();

-- Releasing a slot (an admin correction) gives the seat back.
create or replace function clipathon.release_slot()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  update clipathon.brands
     set slots_taken = greatest(0, slots_taken - 1)
   where id = old.brand_id;
  return old;
end;
$$;

create trigger trg_release_slot
  after delete on clipathon.slots
  for each row execute function clipathon.release_slot();

-- A change request moves the counter between two brands atomically.
create or replace function clipathon.move_slot()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare b record;
begin
  if new.brand_id = old.brand_id then
    return new;
  end if;

  select * into b from clipathon.brands where id = new.brand_id for update;
  if b.slots_taken >= b.slots_total then
    raise exception 'Cannot move: brand % is full', b.name using errcode = 'check_violation';
  end if;

  update clipathon.brands set slots_taken = greatest(0, slots_taken - 1) where id = old.brand_id;
  update clipathon.brands set slots_taken = slots_taken + 1 where id = new.brand_id;

  new.changed_from := old.brand_id;
  new.changed_at   := now();
  return new;
end;
$$;

create trigger trg_move_slot
  before update of brand_id on clipathon.slots
  for each row execute function clipathon.move_slot();

-- -------------------------------------------------------------
-- Submission status ladder
-- -------------------------------------------------------------
-- Keeps status consistent with what is actually present, so the creator
-- dashboard and the QC queue can never disagree about whether an entry
-- is complete.
create or replace function clipathon.sync_submission_status()
returns trigger
language plpgsql
as $$
begin
  if new.post_url is distinct from old.post_url and new.post_url is not null then
    new.link_submitted_at := coalesce(new.link_submitted_at, now());
  end if;
  if new.drive_url is distinct from old.drive_url and new.drive_url is not null then
    new.file_uploaded_at := coalesce(new.file_uploaded_at, now());
  end if;

  -- Only advance the automatic part of the ladder. Anything QC has
  -- already moved past 'complete' is left alone.
  if new.status in ('not_started','link_submitted','file_uploaded','complete') then
    new.status := case
      when new.post_url is not null and new.drive_url is not null then 'complete'
      when new.drive_url is not null then 'file_uploaded'
      when new.post_url is not null then 'link_submitted'
      else 'not_started'
    end::clipathon.submission_status;
  end if;

  -- Approval stamp, which is what the referral payout keys off.
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.approved_at := coalesce(new.approved_at, now());
  end if;
  if new.status <> 'verified' then
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger trg_sync_submission
  before update on clipathon.submissions
  for each row execute function clipathon.sync_submission_status();

-- Nothing may be submitted after the cutoff. The window closes
-- automatically and there is no grace period.
create or replace function clipathon.enforce_cutoff()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare cy record;
begin
  select * into cy from clipathon.cycles where id = new.cycle_id;
  if cy.status in ('closed','archived') then
    raise exception 'Cycle % is closed', cy.name using errcode = 'check_violation';
  end if;

  -- Creator-side changes stop at the cutoff. Admin QC continues after it.
  if not clipathon.is_admin()
     and now() > cy.submission_cutoff_at
     and (new.post_url is distinct from coalesce(old.post_url, null)
       or new.drive_url is distinct from coalesce(old.drive_url, null)) then
    raise exception 'The submission window closed at %', cy.submission_cutoff_at
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_enforce_cutoff
  before insert or update on clipathon.submissions
  for each row execute function clipathon.enforce_cutoff();

-- -------------------------------------------------------------
-- Snapshots are evidence
-- -------------------------------------------------------------
create or replace function clipathon.block_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Metric snapshots are append only. Capture a new snapshot instead of editing %.', old.id
    using errcode = 'check_violation';
end;
$$;

create trigger trg_snapshot_no_update
  before update or delete on clipathon.metric_snapshots
  for each row execute function clipathon.block_snapshot_mutation();

-- -------------------------------------------------------------
-- Scoring weights and the prize pool freeze once published
-- -------------------------------------------------------------
-- "Published before the creation window opens and never changed after
-- results are known" is a promise to 500 creators. Enforced here.
create or replace function clipathon.freeze_scoring()
returns trigger
language plpgsql
as $$
begin
  if old.scoring_locked_at is not null
     and new.scoring_weights is distinct from old.scoring_weights then
    raise exception 'Scoring weights were locked at % and cannot be changed', old.scoring_locked_at
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_freeze_scoring
  before update on clipathon.cycles
  for each row execute function clipathon.freeze_scoring();

create or replace function clipathon.freeze_prizes()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null and (
       new.cash_minor  is distinct from old.cash_minor
    or new.non_cash    is distinct from old.non_cash
    or new.rank_from   is distinct from old.rank_from
    or new.rank_to     is distinct from old.rank_to
    or new.seats       is distinct from old.seats
  ) then
    raise exception 'Prize tier "%" was published at % and cannot be revised', old.label, old.published_at
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_freeze_prizes
  before update on clipathon.prizes
  for each row execute function clipathon.freeze_prizes();

-- -------------------------------------------------------------
-- Referrals: the approval rule
-- -------------------------------------------------------------
-- Three triggers move a referral through its funnel, and exactly one of
-- them pays.

-- 1. Registration approved -> the referral reaches 'verified'. No points.
create or replace function clipathon.referral_on_registration()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  -- Create the referral row the moment an attributed registration exists.
  if new.referred_by is not null then
    insert into clipathon.referrals (cycle_id, referrer_id, referred_creator_id, registration_id, stage)
    values (new.cycle_id, new.referred_by, new.creator_id, new.id, 'invited')
    on conflict (cycle_id, referred_creator_id) do nothing;
  end if;

  if new.status = 'approved' and old.status is distinct from 'approved' then
    update clipathon.referrals
       set stage = 'verified', stage_changed_at = now()
     where registration_id = new.id and stage = 'invited';
  end if;

  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    update clipathon.referrals
       set stage = 'rejected', stage_changed_at = now()
     where registration_id = new.id and stage <> 'approved';
  end if;

  return new;
end;
$$;

create trigger trg_referral_on_registration
  after insert or update of status, referred_by on clipathon.registrations
  for each row execute function clipathon.referral_on_registration();

-- 2. Submission complete -> 'submitted'. Still no points.
-- 3. Submission verified -> 'approved', AND the ledger is credited once.
--    This is the rule: a referral pays only when the creator it brought
--    in gets a clip approved. Not on signup, not on verification.
create or replace function clipathon.referral_on_submission()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  ref     record;
  reg     record;
  season  uuid;
  award   integer := 250;   -- kept in step with the task catalogue in 010
begin
  select * into reg from clipathon.registrations where id = new.registration_id;
  if reg is null then return new; end if;

  select * into ref from clipathon.referrals
   where cycle_id = new.cycle_id and referred_creator_id = reg.creator_id;
  if ref is null then return new; end if;

  -- Pipeline only.
  if new.is_complete and ref.stage in ('invited','verified') then
    update clipathon.referrals
       set stage = 'submitted', stage_changed_at = now()
     where id = ref.id;
  end if;

  -- The paying transition.
  if new.status = 'verified' and old.status is distinct from 'verified' and ref.stage <> 'approved' then
    select c.season_id into season from clipathon.cycles c where c.id = new.cycle_id;
    if season is null then
      raise exception 'Cycle % has no season; cannot credit referral points', new.cycle_id
        using errcode = 'check_violation';
    end if;

    update clipathon.referrals
       set stage = 'approved',
           stage_changed_at = now(),
           qualifying_submission_id = new.id,
           points_awarded = award,
           points_awarded_at = now()
     where id = ref.id;

    insert into clipathon.points_ledger
      (season_id, cycle_id, creator_id, source, amount, reason, referral_id, submission_id)
    values
      (season, new.cycle_id, ref.referrer_id, 'referral', award,
       'Referred creator had a clip approved', ref.id, new.id)
    on conflict do nothing;
  end if;

  -- Disqualification kills the referral. It never pays.
  if new.status = 'disqualified' and ref.stage <> 'approved' then
    update clipathon.referrals
       set stage = 'rejected', stage_changed_at = now()
     where id = ref.id;
  end if;

  return new;
end;
$$;

-- Fires on ANY update, not `after update of status`. The status column
-- is set by the BEFORE trigger above, not by the UPDATE statement, and
-- `UPDATE OF` matches the columns named in the statement rather than
-- what a BEFORE trigger went on to change. Scoping it to status meant a
-- creator uploading their raw file never advanced the referral, because
-- the statement only named drive_url. The guards inside the function
-- make firing on every update harmless.
create trigger trg_referral_on_submission
  after update on clipathon.submissions
  for each row execute function clipathon.referral_on_submission();

-- -------------------------------------------------------------
-- Bonus task points
-- -------------------------------------------------------------
-- A completion writes exactly one ledger row; a revocation writes the
-- matching negative rather than deleting anything.
create or replace function clipathon.task_points()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  t      record;
  reg    record;
  season uuid;
  orig   uuid;
begin
  select * into t   from clipathon.tasks where id = new.task_id;
  select * into reg from clipathon.registrations where id = new.registration_id;
  select c.season_id into season from clipathon.cycles c where c.id = reg.cycle_id;

  if season is null then
    raise exception 'Cycle % has no season; cannot credit task points', reg.cycle_id
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    insert into clipathon.points_ledger
      (season_id, cycle_id, creator_id, source, amount, reason, task_completion_id)
    values
      (season, reg.cycle_id, reg.creator_id, 'task', t.points, 'Bonus task: ' || t.title, new.id);

  elsif tg_op = 'UPDATE' and new.revoked_at is not null and old.revoked_at is null then
    select id into orig from clipathon.points_ledger
      where task_completion_id = new.id and source = 'task' and amount > 0
      limit 1;
    insert into clipathon.points_ledger
      (season_id, cycle_id, creator_id, source, amount, reason, reverses_id, created_by)
    values
      (season, reg.cycle_id, reg.creator_id, 'task', -t.points,
       'Revoked: ' || coalesce(new.revoked_reason, 'spot check failed'), orig, new.revoked_by);
  end if;

  return new;
end;
$$;

create trigger trg_task_points
  after insert or update of revoked_at on clipathon.task_completions
  for each row execute function clipathon.task_points();

-- -------------------------------------------------------------
-- Support SLA
-- -------------------------------------------------------------
create or replace function clipathon.set_ticket_sla()
returns trigger
language plpgsql
as $$
begin
  new.sla_due_at := new.created_at + case new.priority
    when 'critical' then interval '15 minutes'
    when 'high'     then interval '1 hour'
    when 'normal'   then interval '4 hours'
    else                 interval '24 hours'
  end;
  return new;
end;
$$;

create trigger trg_ticket_sla
  before insert on clipathon.support_tickets
  for each row execute function clipathon.set_ticket_sla();

-- -------------------------------------------------------------
-- Announcement notification schedule
-- -------------------------------------------------------------
-- Derived, never typed. Nobody should be manually sending a reminder at
-- midnight because a session was scheduled late.
create or replace function clipathon.set_announcement_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.event_at is not null then
    new.notify_t24_at := new.event_at - interval '24 hours';
    new.notify_t1_at  := new.event_at - interval '1 hour';
  end if;
  return new;
end;
$$;

create trigger trg_announcement_schedule
  before insert or update of event_at on clipathon.announcements
  for each row execute function clipathon.set_announcement_schedule();

-- -------------------------------------------------------------
-- Audit trail
-- -------------------------------------------------------------
create or replace function clipathon.write_audit()
returns trigger
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  actor uuid := auth.uid();
  mail  text;
begin
  select email into mail from clipathon.admin_users where user_id = actor limit 1;

  insert into clipathon.audit_log (actor_id, actor_email, action, target_table, target_id, old_data, new_data)
  values (
    actor, mail, tg_op, tg_table_name,
    case when tg_op = 'DELETE' then (to_jsonb(old)->>'id') else (to_jsonb(new)->>'id') end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  -- The tables where "who changed this and when" is worth the write cost.
  foreach t in array array[
    'registrations','submissions','scores','slots','prizes','prize_awards','payouts','cycles'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on clipathon.%I
         for each row execute function clipathon.write_audit()',
      'trg_audit_' || t, t
    );
  end loop;
end $$;
