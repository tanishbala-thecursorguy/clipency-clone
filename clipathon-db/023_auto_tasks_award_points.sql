-- 023  Automatic tasks never paid out.
--
-- Seven of the thirteen tasks in a cycle are is_auto = true, worth 1620 of
-- the 2600 points on the board: verify a handle, complete your profile,
-- connect a second platform, lock a slot, submit the link, upload the raw
-- file, publish early. The dashboard ticked them off on screen by looking at
-- the creator's own state, but nothing ever wrote a task_completions row for
-- them, so trg_task_points never fired and the ledger stayed empty. The
-- progress bar reads the ledger, so it never moved, and the leaderboard is
-- the ledger, so it never moved either.
--
-- The conditions are evaluated here, in the database, so a creator cannot
-- award themselves points by editing the page. Awarding is idempotent: a task
-- already recorded, revoked or not, is never recorded again.
--
-- NOTE: the array appends in this file are missing their ::text casts, which
-- makes the function raise "malformed array literal" on the first append.
-- 023c carries the corrected body. This file is kept as it was applied so the
-- history reads honestly.

create or replace function clipathon.award_auto_tasks(p_registration_id uuid)
returns integer
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $fn$
declare
  reg            record;
  cyc            record;
  cr             record;
  sub            record;
  earned         text[] := '{}';
  verified_count integer;
  platform_count integer;
  has_slot       boolean;
  n              integer := 0;
begin
  select * into reg from clipathon.registrations where id = p_registration_id;
  if not found then return 0; end if;
  if reg.status <> 'approved' then return 0; end if;

  select * into cyc from clipathon.cycles   where id = reg.cycle_id;
  select * into cr  from clipathon.creators where id = reg.creator_id;

  select count(*), count(distinct platform)
    into verified_count, platform_count
    from clipathon.creator_accounts
   where creator_id = reg.creator_id and status = 'verified';

  select exists(select 1 from clipathon.slots where registration_id = reg.id) into has_slot;
  select * into sub from clipathon.submissions where registration_id = reg.id limit 1;

  if verified_count >= 1 then earned := earned || 'verify-handle'; end if;

  if coalesce(btrim(cr.display_name), '') <> ''
     and coalesce(btrim(cr.city), '') <> ''
     and coalesce(array_length(reg.content_categories, 1), 0) > 0 then
    earned := earned || 'profile-complete';
  end if;

  if platform_count >= 2 then earned := earned || 'second-platform'; end if;
  if has_slot           then earned := earned || 'pick-slot';        end if;

  if coalesce(btrim(sub.post_url), '') <> '' then
    earned := earned || 'submit-link';
    if sub.link_submitted_at is not null
       and cyc.slots_close_at is not null
       and sub.link_submitted_at < cyc.slots_close_at + interval '48 hours' then
      earned := earned || 'early-post';
    end if;
  end if;

  if coalesce(btrim(sub.file_name), '') <> '' then earned := earned || 'upload-raw'; end if;

  if array_length(earned, 1) is null then return 0; end if;

  insert into clipathon.task_completions (task_id, registration_id, auto_detected)
  select t.id, reg.id, true
    from clipathon.tasks t
   where t.cycle_id = reg.cycle_id
     and t.is_active and t.is_auto
     and t.code = any(earned)
     and not exists (
       select 1 from clipathon.task_completions tc
        where tc.task_id = t.id and tc.registration_id = reg.id
     )
  on conflict do nothing;

  get diagnostics n = row_count;
  return n;
end
$fn$;

comment on function clipathon.award_auto_tasks(uuid) is
  'Evaluates every is_auto task for one registration and records the ones now earned. Idempotent. Internal: call sync_auto_tasks() from the client.';


-- Same thing across every approved registration a creator holds, which is
-- what the creator level triggers need.
create or replace function clipathon.award_auto_tasks_for_creator(p_creator_id uuid)
returns integer
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $fn$
declare r record; n integer := 0;
begin
  for r in
    select id from clipathon.registrations
     where creator_id = p_creator_id and status = 'approved'
  loop
    n := n + clipathon.award_auto_tasks(r.id);
  end loop;
  return n;
end
$fn$;


-- What the dashboard calls. Resolves the caller from the JWT, so it can only
-- ever sync its own account.
create or replace function clipathon.sync_auto_tasks()
returns jsonb
language plpgsql
security definer
set search_path = clipathon, pg_temp
as $fn$
declare cid uuid; n integer;
begin
  cid := clipathon.my_creator_id();
  if cid is null then
    return jsonb_build_object('ok', false, 'awarded', 0, 'message', 'No creator for this session');
  end if;
  n := clipathon.award_auto_tasks_for_creator(cid);
  return jsonb_build_object('ok', true, 'awarded', n);
end
$fn$;

revoke execute on function clipathon.award_auto_tasks(uuid)             from public, anon, authenticated;
revoke execute on function clipathon.award_auto_tasks_for_creator(uuid) from public, anon, authenticated;
revoke execute on function clipathon.sync_auto_tasks()                  from public, anon;
grant  execute on function clipathon.sync_auto_tasks()                  to authenticated;
