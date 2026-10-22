-- ============================================================
-- 025 · Task verification
-- ============================================================
-- Until now claimTask() was a bare insert and trg_task_points paid out on
-- that insert, so anything a creator could reach from the console was worth
-- its full value the moment they asked for it. This migration puts a gate in
-- front of the ledger.
--
-- Each task declares how it is proven:
--   honor        press the button, points land, no proof
--   code         a short code given out in the session, checked in the db
--   proof_url    a public link, held pending until a reviewer approves
--   proof_image  a screenshot in storage, held pending until approved
--   admin_only   the team marks it, a creator cannot claim it at all
--   roster       matched in bulk from an exported member list
--
-- The gate is a BEFORE INSERT trigger rather than an RLS policy, because a
-- policy cannot rewrite the row. A creator posting status = 'approved' from
-- devtools gets it overwritten, not rejected, which is the behaviour we want.
-- ============================================================

do $$ begin
  create type clipathon.verify_mode as enum
    ('honor','code','proof_url','proof_image','admin_only','roster');
exception when duplicate_object then null; end $$;

do $$ begin
  create type clipathon.completion_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

alter table clipathon.tasks
  add column if not exists verify_mode clipathon.verify_mode not null default 'honor',
  add column if not exists proof_hint  text;

-- Existing rows and the whole award_auto_tasks path default to approved, so
-- nothing already scored moves and the seven automatic tasks keep working.
alter table clipathon.task_completions
  add column if not exists status      clipathon.completion_status not null default 'approved',
  add column if not exists proof_url   text,
  add column if not exists proof_path  text,
  add column if not exists proof_note  text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create index if not exists task_completions_pending_idx
  on clipathon.task_completions (status, completed_at desc)
  where status = 'pending';

-- ------------------------------------------------------------
-- Codes live away from tasks
-- ------------------------------------------------------------
-- tasks_read lets any creator select every column of every active task. A
-- verify_code sitting on that table would be readable by the people it is
-- meant to test, so it lives here behind an admin only policy and is only
-- ever read by the SECURITY DEFINER trigger below.
create table if not exists clipathon.task_secrets (
  task_id     uuid primary key references clipathon.tasks(id) on delete cascade,
  verify_code text not null,
  updated_at  timestamptz not null default now(),
  constraint task_secrets_code_ok check (btrim(verify_code) <> '' and length(verify_code) <= 32)
);

alter table clipathon.task_secrets enable row level security;

drop policy if exists task_secrets_admin on clipathon.task_secrets;
create policy task_secrets_admin on clipathon.task_secrets
  for all
  using      (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

drop trigger if exists trg_task_secrets_touch on clipathon.task_secrets;
create trigger trg_task_secrets_touch
  before update on clipathon.task_secrets
  for each row execute function clipathon.touch_updated_at();

-- ------------------------------------------------------------
-- The gate
-- ------------------------------------------------------------
create or replace function clipathon.enforce_claim()
returns trigger
language plpgsql
security definer
set search_path to 'clipathon','pg_temp'
as $fn$
declare
  t    record;
  code text;
begin
  select * into t from clipathon.tasks where id = new.task_id;
  if not found then
    raise exception 'Unknown task' using errcode = 'check_violation';
  end if;

  -- An operator acting through the console keeps whatever it set. The console
  -- is already behind has_role, so re-deciding here would only fight it.
  if clipathon.is_admin() then
    return new;
  end if;

  -- award_auto_tasks is the only caller that sets auto_detected, and it may
  -- only do so for a task that is genuinely automatic. Without this check a
  -- creator could post auto_detected = true on a manual task and skip the gate.
  if new.auto_detected then
    if not t.is_auto then
      raise exception 'That task is not scored automatically' using errcode = 'check_violation';
    end if;
    new.status := 'approved';
    return new;
  end if;

  if t.is_auto then
    raise exception 'That task is scored for you, there is nothing to claim'
      using errcode = 'check_violation';
  end if;

  case t.verify_mode
    when 'admin_only', 'roster' then
      raise exception 'The Clipathon team marks that one, you do not need to claim it'
        using errcode = 'check_violation';

    when 'honor' then
      new.status := 'approved';

    when 'code' then
      select s.verify_code into code from clipathon.task_secrets s where s.task_id = t.id;
      if coalesce(btrim(code), '') = '' then
        raise exception 'No code has been set for that task yet' using errcode = 'check_violation';
      end if;
      if upper(btrim(coalesce(new.proof_note, ''))) <> upper(btrim(code)) then
        raise exception 'That code is not right' using errcode = 'check_violation';
      end if;
      new.status := 'approved';

    when 'proof_url' then
      if coalesce(new.proof_url, '') !~* '^https?://' then
        raise exception 'A link is required for that task' using errcode = 'check_violation';
      end if;
      new.status := 'pending';

    when 'proof_image' then
      if coalesce(btrim(new.proof_path), '') = '' then
        raise exception 'A screenshot is required for that task' using errcode = 'check_violation';
      end if;
      new.status := 'pending';
  end case;

  -- A creator never writes the review columns, whatever the page sends.
  new.reviewed_by  := null;
  new.reviewed_at  := null;
  new.review_note  := null;
  new.revoked_at   := null;
  new.revoked_by   := null;
  new.revoked_reason := null;

  return new;
end
$fn$;

drop trigger if exists trg_enforce_claim on clipathon.task_completions;
create trigger trg_enforce_claim
  before insert on clipathon.task_completions
  for each row execute function clipathon.enforce_claim();

-- ------------------------------------------------------------
-- Points follow approval, not the insert
-- ------------------------------------------------------------
-- Credit and reversal are both driven off the net of this completion's own
-- ledger rows rather off "has it ever been credited". That makes the whole
-- thing idempotent in both directions: a double fire cannot pay twice, and
-- rejected then approved again lands back on the right total.
create or replace function clipathon.task_points()
returns trigger
language plpgsql
security definer
set search_path to 'clipathon','pg_temp'
as $fn$
declare
  t       record;
  reg     record;
  season  uuid;
  net     integer;
  base_id uuid;
  last_id uuid;
begin
  select * into t   from clipathon.tasks         where id = new.task_id;
  select * into reg from clipathon.registrations where id = new.registration_id;
  select c.season_id into season from clipathon.cycles c where c.id = reg.cycle_id;

  if season is null then
    raise exception 'Cycle % has no season; cannot credit task points', reg.cycle_id
      using errcode = 'check_violation';
  end if;

  -- points_task_once_idx is unique on task_completion_id, so only the first
  -- credit may carry the completion id. Everything after it hangs off
  -- reverses_id instead, which makes the whole history one walkable chain:
  -- credit, reversal, re-credit, each one reversing the row before it.
  with recursive chain as (
    select l.id, l.amount, l.created_at
      from clipathon.points_ledger l
     where l.task_completion_id = new.id and l.source = 'task'
    union all
    select l.id, l.amount, l.created_at
      from clipathon.points_ledger l
      join chain ch on l.reverses_id = ch.id
  )
  select coalesce(sum(amount), 0),
         (select id from chain order by created_at, id limit 1),
         (select id from chain order by created_at desc, id desc limit 1)
    into net, base_id, last_id
    from chain;

  -- CREDIT. Only an approved completion is worth anything. A claim sitting in
  -- pending is a request, not a score.
  if new.status = 'approved' and new.revoked_at is null and net <= 0 then
    if base_id is null then
      insert into clipathon.points_ledger
        (season_id, cycle_id, creator_id, source, amount, reason, task_completion_id)
      values
        (season, reg.cycle_id, reg.creator_id, 'task', t.points,
         'Bonus task: ' || t.title, new.id);
    else
      insert into clipathon.points_ledger
        (season_id, cycle_id, creator_id, source, amount, reason, reverses_id, created_by)
      values
        (season, reg.cycle_id, reg.creator_id, 'task', t.points,
         'Reinstated: ' || t.title, last_id, auth.uid());
    end if;
    return new;
  end if;

  -- REVERSE. One negative row, whether the cause was a revoke or a rejection.
  if tg_op = 'UPDATE' and net > 0
     and (
       (new.revoked_at is not null and old.revoked_at is null)
       or (new.status <> 'approved' and old.status = 'approved')
     ) then
    insert into clipathon.points_ledger
      (season_id, cycle_id, creator_id, source, amount, reason, reverses_id, created_by)
    values
      (season, reg.cycle_id, reg.creator_id, 'task', -t.points,
       case when new.revoked_at is not null
            then 'Revoked: ' || coalesce(new.revoked_reason, 'spot check failed')
            else 'Proof rejected: ' || coalesce(new.review_note, 'did not meet the bar')
       end,
       last_id, coalesce(new.revoked_by, new.reviewed_by));
  end if;

  return new;
end
$fn$;

drop trigger if exists trg_task_points on clipathon.task_completions;
create trigger trg_task_points
  after insert or update of revoked_at, status on clipathon.task_completions
  for each row execute function clipathon.task_points();

-- ------------------------------------------------------------
-- Review queue API
-- ------------------------------------------------------------
create or replace function clipathon.admin_review_completion(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns boolean
language plpgsql
security definer
set search_path to 'clipathon','pg_temp'
as $fn$
declare n integer;
begin
  if not clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  update clipathon.task_completions
     set status      = case when p_approve then 'approved' else 'rejected' end::clipathon.completion_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id
     and status = 'pending';

  get diagnostics n = row_count;
  return n > 0;
end
$fn$;

revoke all on function clipathon.admin_review_completion(uuid, boolean, text) from public;
grant execute on function clipathon.admin_review_completion(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------
-- How each manual task is proven
-- ------------------------------------------------------------
update clipathon.tasks set verify_mode = 'code', proof_hint =
  'Enter the code we read out at the end of the session.'
 where code in ('rules-brief','brand-deepdive');

update clipathon.tasks set verify_mode = 'roster', proof_hint =
  'Join with your registered number and we award this from the group member list.'
 where code = 'join-wa';

update clipathon.tasks set verify_mode = 'proof_image', proof_hint =
  'Upload a screenshot of the story with the tag visible.'
 where code = 'share-announce';

update clipathon.tasks set verify_mode = 'admin_only', proof_hint =
  'Our team marks this at the venue once you have recorded it.'
 where code = 'testimonial';
