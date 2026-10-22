-- =============================================================
-- CLIPATHON · 016 · the admin console API
-- =============================================================
-- Everything the ops team does, as functions rather than raw table
-- writes, for three reasons:
--
--   * several of these touch more than one table and must not half
--     happen (approving a registration also advances a referral)
--   * the role check belongs next to the action, not scattered across
--     a front end that could forget one
--   * every one of them is a thing somebody will later ask "who did
--     that and when", which means the audit trail has to be automatic
--
-- Direct table writes still work for simple edits (a brief, a session
-- time) because the policies in 008 already scope them by role. These
-- are the actions where "simple write" would be wrong.
-- =============================================================

-- -------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------
-- 012 granted insert/update on the tables a CREATOR writes. The admin
-- tables were never granted, so RLS would have allowed an ops edit that
-- the grant then refused. RLS stays the real gate: a creator holds no
-- policy permitting any of these, so a broad grant to `authenticated`
-- gives them nothing.
grant insert, update, delete on
  clipathon.registrations, clipathon.creator_accounts, clipathon.brands,
  clipathon.brand_assets, clipathon.sessions, clipathon.announcements,
  clipathon.tasks, clipathon.cycles, clipathon.seasons, clipathon.scores,
  clipathon.metric_snapshots, clipathon.prizes, clipathon.prize_awards,
  clipathon.certificates, clipathon.payouts, clipathon.ambassadors,
  clipathon.season_standings, clipathon.points_ledger, clipathon.admin_users
to authenticated;

-- Who verified a handle is worth knowing when somebody later disputes
-- it. 003 recorded the timestamp but not the person.
alter table clipathon.creator_accounts
  add column if not exists verified_by uuid references auth.users (id) on delete set null;

-- -------------------------------------------------------------
-- Bootstrap the first owners
-- -------------------------------------------------------------
-- Seeded from the existing clipping admins, because those are the
-- people who already run the platform. Everyone else is added from
-- inside the console by an owner.
insert into clipathon.admin_users (user_id, email, full_name, role)
select u.id, u.email, split_part(u.email, '@', 1), 'owner'
  from auth.users u
 where lower(u.email) in ('beraayush79@gmail.com', 'ayush@clipency.in')
on conflict (user_id) do nothing;

-- -------------------------------------------------------------
-- Guard
-- -------------------------------------------------------------
create or replace function clipathon.require_role(roles clipathon.admin_role[])
returns void
language plpgsql
stable
security definer
set search_path = clipathon, pg_temp
as $$
begin
  if not clipathon.has_role(roles) then
    raise exception 'Not permitted. This action needs one of: %', array_to_string(roles, ', ')
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- -------------------------------------------------------------
-- Registration review
-- -------------------------------------------------------------
-- The single busiest action of the whole event. Approving also advances
-- any referral pointing at this creator, which the trigger in 009 does,
-- so this only has to set the status correctly and stamp the reviewer.
create or replace function clipathon.admin_review_registration(
  p_registration_id uuid,
  p_outcome         text,           -- approved | rejected | needs_info
  p_note            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare r record;
begin
  perform clipathon.require_role(array['ops','reviewer']::clipathon.admin_role[]);

  if p_outcome not in ('approved','rejected','needs_info') then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome');
  end if;

  update clipathon.registrations
     set status            = p_outcome::clipathon.registration_status,
         review_notes      = coalesce(p_note, review_notes),
         needs_info_reason = case when p_outcome = 'needs_info' then p_note else null end,
         needs_info_until  = case when p_outcome = 'needs_info' then now() + interval '24 hours' end,
         rejected_reason   = case when p_outcome = 'rejected' then p_note else null end,
         reviewed_by       = auth.uid(),
         reviewed_at       = now()
   where id = p_registration_id
  returning * into r;

  if r.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', r.status);
end;
$$;

-- Clearing the queue one row at a time is fine at 40 registrations and
-- painful at 450, which is the number the playbook plans for.
create or replace function clipathon.admin_review_bulk(
  p_ids     uuid[],
  p_outcome text,
  p_note    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare i uuid; n integer := 0;
begin
  perform clipathon.require_role(array['ops','reviewer']::clipathon.admin_role[]);
  foreach i in array coalesce(p_ids, '{}')
  loop
    if (clipathon.admin_review_registration(i, p_outcome, p_note)->>'ok')::boolean then
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'updated', n);
end;
$$;

-- -------------------------------------------------------------
-- Account verification, the checker
-- -------------------------------------------------------------
-- This is the piece that was missing. submit_account_for_check() records
-- a creator's claim and deliberately cannot verify it; this is the other
-- half, and it is admin only because a client that could call it could
-- self-grant a handle and squat somebody else's.
--
-- An edge function that reads the public bio can call this too, with
-- the service role, once it exists. The rule it enforces is the same.
create or replace function clipathon.admin_verify_account(
  p_account_id uuid,
  p_verified   boolean,
  p_error      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare a record;
begin
  perform clipathon.require_role(array['ops','reviewer']::clipathon.admin_role[]);

  update clipathon.creator_accounts
     set status       = case when p_verified then 'verified' else 'failed' end::clipathon.account_status,
         verified_at  = case when p_verified then now() end,
         verified_by  = case when p_verified then auth.uid() end,
         verify_error = case when p_verified then null else p_error end,
         updated_at   = now()
   where id = p_account_id
  returning * into a;

  if a.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', a.status, 'handle', a.handle);
end;
$$;

-- -------------------------------------------------------------
-- QC
-- -------------------------------------------------------------
create or replace function clipathon.admin_qc_submission(
  p_submission_id uuid,
  p_action        text,             -- verify | reject | disqualify | review
  p_note          text default null,
  p_quality       numeric default null,
  p_compliance    numeric default null,
  p_dq_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare s record;
begin
  perform clipathon.require_role(array['ops','reviewer']::clipathon.admin_role[]);

  if p_action not in ('verify','reject','disqualify','review') then
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;

  update clipathon.submissions
     set status = case p_action
           when 'verify'     then 'verified'
           when 'reject'     then 'rejected'
           when 'disqualify' then 'disqualified'
           else                   'under_review' end::clipathon.submission_status,
         qc_note          = coalesce(p_note, qc_note),
         qc_by            = auth.uid(),
         qc_at            = now(),
         quality_score    = coalesce(p_quality, quality_score),
         compliance_score = coalesce(p_compliance, compliance_score),
         scored_by        = case when p_quality is not null or p_compliance is not null then auth.uid() else scored_by end,
         scored_at        = case when p_quality is not null or p_compliance is not null then now() else scored_at end,
         dq_reason        = case when p_action = 'disqualify'
                                 then coalesce(p_dq_reason, 'other')::clipathon.dq_reason end,
         dq_note          = case when p_action = 'disqualify' then p_note end,
         dq_at            = case when p_action = 'disqualify' then now() end
   where id = p_submission_id
  returning * into s;

  if s.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', s.status);
end;
$$;

-- -------------------------------------------------------------
-- Metric snapshots
-- -------------------------------------------------------------
-- Append only by design, so this inserts and never updates. Marking one
-- final clears any previous final on the same submission, because the
-- unique index allows exactly one.
create or replace function clipathon.admin_capture_snapshot(
  p_submission_id uuid,
  p_views bigint, p_likes bigint default 0, p_comments bigint default 0,
  p_shares bigint default 0, p_saves bigint default 0,
  p_is_final boolean default false,
  p_screenshot text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  cy uuid; nextno smallint; newid uuid;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);

  select cycle_id into cy from clipathon.submissions where id = p_submission_id;
  if cy is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select coalesce(max(snapshot_no), 0) + 1 into nextno
    from clipathon.metric_snapshots where submission_id = p_submission_id;

  if p_is_final then
    update clipathon.metric_snapshots set is_final = false
     where submission_id = p_submission_id and is_final;
  end if;

  insert into clipathon.metric_snapshots
    (submission_id, cycle_id, snapshot_no, is_final, views, likes, comments, shares, saves,
     screenshot_url, captured_by, source)
  values
    (p_submission_id, cy, nextno, p_is_final, p_views, p_likes, p_comments, p_shares, p_saves,
     p_screenshot, auth.uid(), 'manual')
  returning id into newid;

  return jsonb_build_object('ok', true, 'snapshot_no', nextno, 'id', newid);
end;
$$;

-- The append-only guard from 009 blocked admin_capture_snapshot from
-- clearing the previous final flag, which is the guard working, not a
-- bug. But re-pointing WHICH snapshot is authoritative is not editing
-- evidence: the numbers cannot move.
--
-- So the exception is drawn as narrowly as it can be. An update passes
-- only when it demotes is_final from true to false and every other
-- column is byte identical. Anything else, including promoting a
-- snapshot to final or touching a single view count, still raises.
create or replace function clipathon.block_snapshot_mutation()
returns trigger language plpgsql
set search_path = clipathon, pg_temp
as $$
begin
  -- Compared column by column rather than as a whole-row diff:
  -- engagement_rate is GENERATED, and in a BEFORE trigger NEW has not
  -- had it computed yet, so a row-level comparison always disagrees.
  -- Naming the columns also makes it obvious what is being protected.
  if tg_op = 'UPDATE'
     and old.is_final and not new.is_final
     and new.submission_id  is not distinct from old.submission_id
     and new.cycle_id       is not distinct from old.cycle_id
     and new.snapshot_no    is not distinct from old.snapshot_no
     and new.captured_at    is not distinct from old.captured_at
     and new.views          is not distinct from old.views
     and new.likes          is not distinct from old.likes
     and new.comments       is not distinct from old.comments
     and new.shares         is not distinct from old.shares
     and new.saves          is not distinct from old.saves
     and new.screenshot_url is not distinct from old.screenshot_url
     and new.raw            is not distinct from old.raw
     and new.source         is not distinct from old.source then
    return new;
  end if;

  raise exception 'Metric snapshots are append only. Capture a new snapshot instead of editing %.', old.id
    using errcode = 'check_violation';
end;
$$;

-- -------------------------------------------------------------
-- Scoring
-- -------------------------------------------------------------
-- Normalises each component to 0..100 across the cycle, applies the
-- cycle's own weights, and ranks. Re-runnable: it recomputes from the
-- final snapshots every time, and refuses once results are locked.
create or replace function clipathon.admin_run_scoring(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  w        jsonb;
  locked   integer;
  scored   integer := 0;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);

  select scoring_weights into w from clipathon.cycles where id = p_cycle_id;
  if w is null then return jsonb_build_object('ok', false, 'error', 'no_cycle'); end if;

  select count(*) into locked from clipathon.scores
   where cycle_id = p_cycle_id and locked_at is not null;
  if locked > 0 then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'message', 'Results are signed off and locked. Unlock is deliberately not possible.');
  end if;

  with base as (
    select s.id as submission_id, s.brand_id,
           coalesce(m.views, 0)::numeric            as views,
           coalesce(m.engagement_rate, 0)::numeric  as er,
           coalesce(s.quality_score, 0)::numeric    as q,
           coalesce(s.compliance_score, 0)::numeric as c
      from clipathon.submissions s
      left join clipathon.metric_snapshots m
             on m.submission_id = s.id and m.is_final
     where s.cycle_id = p_cycle_id
       and s.status = 'verified'
  ),
  bounds as (
    select nullif(max(views), 0) as mv, nullif(max(er), 0) as me from base
  ),
  calc as (
    select b.submission_id, b.brand_id,
           round(100 * b.views / coalesce(bounds.mv, 1), 2) as vs,
           round(100 * b.er    / coalesce(bounds.me, 1), 2) as es,
           b.q as qs, b.c as cs
      from base b cross join bounds
  ),
  totals as (
    select calc.*,
           round(
             calc.vs * coalesce((w->>'views')::numeric,0)/100 +
             calc.es * coalesce((w->>'engagement')::numeric,0)/100 +
             calc.qs * coalesce((w->>'quality')::numeric,0)/100 +
             calc.cs * coalesce((w->>'compliance')::numeric,0)/100
           , 3) as total
      from calc
  ),
  ranked as (
    select totals.*,
           rank() over (order by total desc)                      as r_overall,
           rank() over (partition by brand_id order by total desc) as r_brand
      from totals
  )
  insert into clipathon.scores
    (cycle_id, submission_id, brand_id, snapshot_id,
     views_score, engagement_score, quality_score, compliance_score,
     weights_used, total_score, rank_in_brand, rank_overall, computed_at)
  select p_cycle_id, r.submission_id, r.brand_id,
         (select m.id from clipathon.metric_snapshots m
           where m.submission_id = r.submission_id and m.is_final limit 1),
         r.vs, r.es, r.qs, r.cs, w, r.total, r.r_brand, r.r_overall, now()
    from ranked r
  on conflict (submission_id) do update
     set views_score      = excluded.views_score,
         engagement_score = excluded.engagement_score,
         quality_score    = excluded.quality_score,
         compliance_score = excluded.compliance_score,
         weights_used     = excluded.weights_used,
         total_score      = excluded.total_score,
         rank_in_brand    = excluded.rank_in_brand,
         rank_overall     = excluded.rank_overall,
         snapshot_id      = excluded.snapshot_id,
         computed_at      = now();

  get diagnostics scored = row_count;
  return jsonb_build_object('ok', true, 'scored', scored);
end;
$$;

-- Two distinct people, enforced by the constraint in 005. This just
-- records whichever half the caller is, and locks when both are in.
create or replace function clipathon.admin_signoff(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare me uuid := auth.uid(); n integer;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);

  update clipathon.scores
     set signed_off_by_1 = coalesce(signed_off_by_1, me)
   where cycle_id = p_cycle_id and locked_at is null
     and (signed_off_by_1 is null or signed_off_by_1 = me);

  update clipathon.scores
     set signed_off_by_2 = me
   where cycle_id = p_cycle_id and locked_at is null
     and signed_off_by_1 is not null and signed_off_by_1 <> me
     and signed_off_by_2 is null;

  update clipathon.scores
     set locked_at = now()
   where cycle_id = p_cycle_id and locked_at is null
     and signed_off_by_1 is not null and signed_off_by_2 is not null;
  get diagnostics n = row_count;

  return jsonb_build_object('ok', true, 'locked', n,
    'message', case when n > 0 then 'Results locked and published.'
                    else 'Your signature is recorded. A second person has to sign off before results lock.' end);
end;
$$;

-- -------------------------------------------------------------
-- Points
-- -------------------------------------------------------------
create or replace function clipathon.admin_adjust_points(
  p_creator_id uuid,
  p_amount     integer,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare se uuid;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);
  if p_amount = 0 then return jsonb_build_object('ok', false, 'error', 'zero'); end if;
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reason_required',
      'message', 'Every manual adjustment needs a reason. It goes on the record next to your name.');
  end if;

  select id into se from clipathon.seasons where is_current limit 1;
  if se is null then return jsonb_build_object('ok', false, 'error', 'no_season'); end if;

  insert into clipathon.points_ledger (season_id, creator_id, source, amount, reason, created_by)
  values (se, p_creator_id, 'adjustment', p_amount, p_reason, auth.uid());

  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------------
-- Retuning a task's points
-- -------------------------------------------------------------
-- The interesting half of this is what happens to creators who already
-- completed the task. The ledger is append only and immutable, so the
-- old rows stay; if p_retro is true we write the DIFFERENCE as a new
-- entry for each of them, with a reason that says why.
--
-- Without that, raising a task from 150 to 200 quietly means early
-- finishers are worth less than latecomers for the same work. With it,
-- everyone lands on the same number and the history still shows exactly
-- what happened.
create or replace function clipathon.admin_set_task_points(
  p_task_id uuid,
  p_points  integer,
  p_retro   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare
  t      record;
  old_p  integer;
  diff   integer;
  se     uuid;
  n      integer := 0;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);
  if p_points is null or p_points <= 0 then
    return jsonb_build_object('ok', false, 'error', 'bad_points');
  end if;

  select * into t from clipathon.tasks where id = p_task_id;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  old_p := t.points;
  diff  := p_points - old_p;

  update clipathon.tasks set points = p_points, updated_at = now() where id = p_task_id;

  if diff <> 0 and p_retro then
    select c.season_id into se from clipathon.cycles c where c.id = t.cycle_id;
    if se is null then
      return jsonb_build_object('ok', true, 'points', p_points, 'adjusted', 0,
        'message', 'Points updated. No season on this cycle, so nothing could be back-credited.');
    end if;

    insert into clipathon.points_ledger
      (season_id, cycle_id, creator_id, source, amount, reason, created_by)
    select se, t.cycle_id, r.creator_id, 'adjustment', diff,
           'Task "' || t.title || '" repriced from ' || old_p || ' to ' || p_points,
           auth.uid()
      from clipathon.task_completions tc
      join clipathon.registrations r on r.id = tc.registration_id
     where tc.task_id = p_task_id and tc.revoked_at is null;
    get diagnostics n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'points', p_points, 'was', old_p,
    'adjusted', n,
    'message', case when n > 0
      then n || ' creator(s) who already finished it were adjusted by ' || diff || '.'
      else 'Points updated. Existing completions keep what they were worth.' end);
end;
$$;

-- -------------------------------------------------------------
-- Slots
-- -------------------------------------------------------------
-- Auto assignment at the close of the window. Everyone approved without
-- a slot goes to whichever brand has the most room, recomputed each
-- time so the result is balanced rather than dumping all of them on one.
create or replace function clipathon.admin_auto_assign(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare r record; b uuid; n integer := 0;
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);

  for r in
    select reg.id
      from clipathon.registrations reg
     where reg.cycle_id = p_cycle_id
       and reg.status = 'approved'
       and not exists (select 1 from clipathon.slots s where s.registration_id = reg.id)
     order by reg.created_at
  loop
    select id into b from clipathon.brands
     where cycle_id = p_cycle_id and slots_taken < slots_total and not is_reserve
     order by (slots_total - slots_taken) desc, display_order
     limit 1;
    exit when b is null;

    insert into clipathon.slots (cycle_id, registration_id, brand_id, auto_assigned)
    values (p_cycle_id, r.id, b, true);
    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'assigned', n,
    'message', case when b is null and n = 0 then 'No capacity left to assign into.'
                    else n || ' creator(s) auto assigned.' end);
end;
$$;

create or replace function clipathon.admin_move_slot(
  p_slot_id  uuid,
  p_brand_id uuid,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);
  update clipathon.slots
     set brand_id = p_brand_id, changed_by = auth.uid(), change_reason = p_reason
   where id = p_slot_id;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'message', sqlerrm);
end;
$$;

-- -------------------------------------------------------------
-- Cycle control
-- -------------------------------------------------------------
create or replace function clipathon.admin_set_cycle_status(
  p_cycle_id uuid,
  p_status   text
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);
  update clipathon.cycles set status = p_status::clipathon.cycle_status where id = p_cycle_id;
  return jsonb_build_object('ok', true, 'status', p_status);
exception when others then
  return jsonb_build_object('ok', false, 'message', sqlerrm);
end;
$$;

-- Publishing the scoring model is one way. After this the trigger in
-- 009 refuses any change to the weights, which is the promise made to
-- creators before the creation window opens.
create or replace function clipathon.admin_lock_scoring(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
begin
  perform clipathon.require_role(array['ops']::clipathon.admin_role[]);
  update clipathon.cycles set scoring_locked_at = now()
   where id = p_cycle_id and scoring_locked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function clipathon.admin_publish_prizes(p_cycle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare n integer;
begin
  perform clipathon.require_role(array['finance']::clipathon.admin_role[]);
  update clipathon.prizes set published_at = now()
   where cycle_id = p_cycle_id and published_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'published', n);
end;
$$;

-- -------------------------------------------------------------
-- Admin roles
-- -------------------------------------------------------------
create or replace function clipathon.admin_upsert_operator(
  p_email text,
  p_role  text,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare u record;
begin
  perform clipathon.require_role(array['owner']::clipathon.admin_role[]);

  select id, email into u from auth.users where lower(email) = lower(trim(p_email));
  if u.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_account',
      'message', 'That email has no login yet. They need to sign in once before you can grant a role.');
  end if;

  insert into clipathon.admin_users (user_id, email, role, is_active, created_by)
  values (u.id, u.email, p_role::clipathon.admin_role, p_active, auth.uid())
  on conflict (user_id) do update
     set role = excluded.role, is_active = excluded.is_active, email = excluded.email;

  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'message', sqlerrm);
end;
$$;

-- -------------------------------------------------------------
-- Console overview
-- -------------------------------------------------------------
-- One call for the landing screen, so the console does not fire twelve
-- counts on every page load.
create or replace function clipathon.admin_overview(p_cycle_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $$
declare cy record;
begin
  if not clipathon.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if p_cycle_id is null then
    select * into cy from clipathon.cycles where status <> 'archived'
     order by registration_closes desc limit 1;
  else
    select * into cy from clipathon.cycles where id = p_cycle_id;
  end if;
  if cy.id is null then return jsonb_build_object('ok', false, 'error', 'no_cycle'); end if;

  return jsonb_build_object(
    'ok', true,
    'cycle', to_jsonb(cy),
    'counts', jsonb_build_object(
      'registrations',   (select count(*) from clipathon.registrations where cycle_id = cy.id),
      'queue',           (select count(*) from clipathon.registrations where cycle_id = cy.id and status in ('pending','needs_info')),
      'approved',        (select count(*) from clipathon.registrations where cycle_id = cy.id and status = 'approved'),
      'rejected',        (select count(*) from clipathon.registrations where cycle_id = cy.id and status = 'rejected'),
      'accounts_pending',(select count(*) from clipathon.creator_accounts where status = 'pending'),
      'with_login',      (select count(*) from clipathon.creators c join clipathon.registrations r on r.creator_id = c.id
                           where r.cycle_id = cy.id and c.auth_user_id is not null),
      'ready',           (select count(*) from clipathon.v_creator_readiness where cycle_id = cy.id and ready_for_slot_selection),
      'slots',           (select count(*) from clipathon.slots where cycle_id = cy.id),
      'slots_auto',      (select count(*) from clipathon.slots where cycle_id = cy.id and auto_assigned),
      'subs_complete',   (select count(*) from clipathon.submissions where cycle_id = cy.id and is_complete),
      'subs_queue',      (select count(*) from clipathon.submissions where cycle_id = cy.id and status in ('complete','under_review')),
      'subs_verified',   (select count(*) from clipathon.submissions where cycle_id = cy.id and status = 'verified'),
      'subs_dq',         (select count(*) from clipathon.submissions where cycle_id = cy.id and status = 'disqualified'),
      'scored',          (select count(*) from clipathon.scores where cycle_id = cy.id),
      'locked',          (select count(*) from clipathon.scores where cycle_id = cy.id and locked_at is not null),
      'tickets_open',    (select count(*) from clipathon.support_tickets where status in ('open','in_progress')),
      'tickets_breach',  (select count(*) from clipathon.support_tickets where first_response_at is null and sla_due_at < now()),
      'total_slots',     cy.total_slots
    ),
    'me', jsonb_build_object(
      'role', (select role from clipathon.admin_users where user_id = auth.uid()),
      'email',(select email from clipathon.admin_users where user_id = auth.uid()))
  );
end;
$$;

-- -------------------------------------------------------------
-- Grants: admins only, and PUBLIC gets nothing (013's rule)
-- -------------------------------------------------------------
revoke execute on all functions in schema clipathon from public;

grant execute on function clipathon.admin_review_registration(uuid, text, text)      to authenticated;
grant execute on function clipathon.admin_review_bulk(uuid[], text, text)            to authenticated;
grant execute on function clipathon.admin_verify_account(uuid, boolean, text)        to authenticated;
grant execute on function clipathon.admin_qc_submission(uuid, text, text, numeric, numeric, text) to authenticated;
grant execute on function clipathon.admin_capture_snapshot(uuid, bigint, bigint, bigint, bigint, bigint, boolean, text) to authenticated;
grant execute on function clipathon.admin_run_scoring(uuid)                          to authenticated;
grant execute on function clipathon.admin_signoff(uuid)                              to authenticated;
grant execute on function clipathon.admin_adjust_points(uuid, integer, text)         to authenticated;
grant execute on function clipathon.admin_set_task_points(uuid, integer, boolean)    to authenticated;
grant execute on function clipathon.admin_auto_assign(uuid)                          to authenticated;
grant execute on function clipathon.admin_move_slot(uuid, uuid, text)                to authenticated;
grant execute on function clipathon.admin_set_cycle_status(uuid, text)               to authenticated;
grant execute on function clipathon.admin_lock_scoring(uuid)                         to authenticated;
grant execute on function clipathon.admin_publish_prizes(uuid)                       to authenticated;
grant execute on function clipathon.admin_upsert_operator(text, text, boolean)       to authenticated;
grant execute on function clipathon.admin_overview(uuid)                             to authenticated;

-- re-grant the creator-facing set that the blanket revoke above removed
grant execute on function clipathon.register_creator(
  text, text, text, text, text, text, text, text, text[], text, boolean) to anon, authenticated;
grant execute on function clipathon.me(text)                             to authenticated;
grant execute on function clipathon.link_auth_user()                     to authenticated;
grant execute on function clipathon.my_registration_state()              to authenticated;
grant execute on function clipathon.request_account_code(text, text)     to authenticated;
grant execute on function clipathon.submit_account_for_check(text, text) to authenticated;
grant execute on function clipathon.is_admin()                           to authenticated;
grant execute on function clipathon.has_role(clipathon.admin_role[])     to authenticated;
grant execute on function clipathon.my_creator_id()                      to authenticated;
grant execute on function clipathon.owns_registration(uuid)              to authenticated;
grant execute on function clipathon.require_role(clipathon.admin_role[]) to authenticated;
