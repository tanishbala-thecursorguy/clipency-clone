-- ============================================================
-- 027 · Roster award
-- ============================================================
-- The honest way to prove someone joined a WhatsApp group is to read the
-- group's own member list, because WhatsApp is the only thing that actually
-- knows. Ops exports the members, pastes the numbers in, and this matches
-- them against registered creators and awards the task in bulk.
--
-- Matching is on the last ten digits, so +91 98765 43210, 919876543210 and
-- 09876543210 all land on the same creator.
-- ============================================================

create or replace function clipathon.normalize_phone(p text)
returns text
language sql
immutable
set search_path to 'clipathon','pg_temp'
as $fn$
  select nullif(right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10), '');
$fn$;

create or replace function clipathon.admin_award_roster(
  p_task_code text,
  p_cycle_id  uuid,
  p_numbers   text[],
  p_brand_id  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'clipathon','pg_temp'
as $fn$
declare
  t   record;
  res jsonb;
begin
  if not clipathon.has_role(array['ops']::clipathon.admin_role[]) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  select * into t
    from clipathon.tasks
   where code = p_task_code and cycle_id = p_cycle_id and is_active;
  if not found then
    raise exception 'No active task % in that cycle', p_task_code
      using errcode = 'check_violation';
  end if;

  -- Deliberately narrow. A bulk award with no proof behind it belongs only to
  -- tasks that were declared roster-verified in the first place.
  if t.verify_mode <> 'roster' then
    raise exception 'Task % is not roster verified', p_task_code
      using errcode = 'check_violation';
  end if;

  -- One statement, no temp tables. Ops pastes one list per brand and the two
  -- calls land in the same request, so a temp table with on commit drop
  -- collided with itself on the second paste.
  with roster as (
    select distinct clipathon.normalize_phone(n) as digits
      from unnest(p_numbers) as n
     where clipathon.normalize_phone(n) is not null
  ),
  hits as (
    select distinct r.id as registration_id, clipathon.normalize_phone(c.phone) as digits
      from clipathon.registrations r
      join clipathon.creators c on c.id = r.creator_id
      left join clipathon.slots s on s.registration_id = r.id
     where r.cycle_id = p_cycle_id
       and r.status = 'approved'
       and clipathon.normalize_phone(c.phone) in (select digits from roster)
       and (p_brand_id is null or s.brand_id = p_brand_id)
  ),
  already as (
    select count(*) as n
      from clipathon.task_completions tc
      join hits h on h.registration_id = tc.registration_id
     where tc.task_id = t.id and tc.revoked_at is null
  ),
  ins as (
    insert into clipathon.task_completions
      (task_id, registration_id, status, auto_detected, review_note, reviewed_by, reviewed_at)
    select t.id, h.registration_id, 'approved', false, 'Roster match', auth.uid(), now()
      from hits h
     where not exists (
       select 1 from clipathon.task_completions tc
        where tc.task_id = t.id and tc.registration_id = h.registration_id
     )
    returning 1
  )
  select jsonb_build_object(
    'task',      p_task_code,
    'pasted',    (select count(*) from roster),
    'matched',   (select count(*) from hits),
    'already',   (select n from already),
    'awarded',   (select count(*) from ins),
    'unmatched', (select coalesce(jsonb_agg(d.digits order by d.digits), '[]'::jsonb)
                    from roster d
                   where not exists (select 1 from hits h where h.digits = d.digits))
  ) into res;

  return res;
end
$fn$;

revoke all on function clipathon.admin_award_roster(text, uuid, text[], uuid) from public;
grant execute on function clipathon.admin_award_roster(text, uuid, text[], uuid) to authenticated;

revoke all on function clipathon.normalize_phone(text) from public;
grant execute on function clipathon.normalize_phone(text) to authenticated;
