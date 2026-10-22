-- 023c  Repair for 023.
--
-- In 023 the codes were appended as `earned := earned || 'verify-handle'`.
-- Postgres types that bare literal as text[] next to a text[] operand, not
-- as a single element, so the first append raised "malformed array literal"
-- and no automatic task could ever be awarded. Each literal is cast to text
-- so the concatenation appends one element, which is the intent.
--
-- This is the body that is live. 023 is left in place so the history reads
-- honestly rather than pretending the mistake never happened.

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

  -- Only a live entry earns. A pending or rejected registration does not.
  if reg.status <> 'approved' then return 0; end if;

  select * into cyc from clipathon.cycles   where id = reg.cycle_id;
  select * into cr  from clipathon.creators where id = reg.creator_id;

  select count(*), count(distinct platform)
    into verified_count, platform_count
    from clipathon.creator_accounts
   where creator_id = reg.creator_id and status = 'verified';

  select exists(select 1 from clipathon.slots where registration_id = reg.id) into has_slot;
  select * into sub from clipathon.submissions where registration_id = reg.id limit 1;

  if verified_count >= 1 then
    earned := earned || 'verify-handle'::text;
  end if;

  if coalesce(btrim(cr.display_name), '') <> ''
     and coalesce(btrim(cr.city), '') <> ''
     and coalesce(array_length(reg.content_categories, 1), 0) > 0 then
    earned := earned || 'profile-complete'::text;
  end if;

  -- Two platforms, not two handles on the same platform.
  if platform_count >= 2 then
    earned := earned || 'second-platform'::text;
  end if;

  if has_slot then
    earned := earned || 'pick-slot'::text;
  end if;

  if coalesce(btrim(sub.post_url), '') <> '' then
    earned := earned || 'submit-link'::text;
    if sub.link_submitted_at is not null
       and cyc.slots_close_at is not null
       and sub.link_submitted_at < cyc.slots_close_at + interval '48 hours' then
      earned := earned || 'early-post'::text;
    end if;
  end if;

  if coalesce(btrim(sub.file_name), '') <> '' then
    earned := earned || 'upload-raw'::text;
  end if;

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

revoke execute on function clipathon.award_auto_tasks(uuid) from public, anon, authenticated;

-- Backfill anyone whose state already satisfied a task before the triggers
-- in 023b existed.
do $do$
declare r record;
begin
  for r in select id from clipathon.registrations where status = 'approved' loop
    perform clipathon.award_auto_tasks(r.id);
  end loop;
end
$do$;
