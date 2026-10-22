-- 023b  Award automatic tasks the moment the thing actually happens, so the
-- ledger is right whether the creator has the dashboard open or an ops person
-- did the work from the admin console.

create or replace function clipathon.touch_auto_tasks_by_registration()
returns trigger language plpgsql security definer
set search_path = clipathon, pg_temp
as $fn$
begin
  perform clipathon.award_auto_tasks(new.registration_id);
  return null;
end
$fn$;

create or replace function clipathon.touch_auto_tasks_by_creator()
returns trigger language plpgsql security definer
set search_path = clipathon, pg_temp
as $fn$
begin
  perform clipathon.award_auto_tasks_for_creator(new.creator_id);
  return null;
end
$fn$;

create or replace function clipathon.touch_auto_tasks_self()
returns trigger language plpgsql security definer
set search_path = clipathon, pg_temp
as $fn$
begin
  perform clipathon.award_auto_tasks_for_creator(new.id);
  return null;
end
$fn$;

create or replace function clipathon.touch_auto_tasks_registration()
returns trigger language plpgsql security definer
set search_path = clipathon, pg_temp
as $fn$
begin
  perform clipathon.award_auto_tasks(new.id);
  return null;
end
$fn$;

drop trigger if exists trg_auto_tasks_accounts    on clipathon.creator_accounts;
drop trigger if exists trg_auto_tasks_creators    on clipathon.creators;
drop trigger if exists trg_auto_tasks_slots       on clipathon.slots;
drop trigger if exists trg_auto_tasks_submissions on clipathon.submissions;
drop trigger if exists trg_auto_tasks_regs        on clipathon.registrations;

-- A handle turning verified is the trigger for verify-handle and second-platform.
create trigger trg_auto_tasks_accounts
after insert or update of status on clipathon.creator_accounts
for each row when (new.status = 'verified')
execute function clipathon.touch_auto_tasks_by_creator();

-- Display name or city filled in feeds profile-complete.
create trigger trg_auto_tasks_creators
after update of display_name, city on clipathon.creators
for each row execute function clipathon.touch_auto_tasks_self();

create trigger trg_auto_tasks_slots
after insert on clipathon.slots
for each row execute function clipathon.touch_auto_tasks_by_registration();

create trigger trg_auto_tasks_submissions
after insert or update of post_url, link_submitted_at, file_name on clipathon.submissions
for each row execute function clipathon.touch_auto_tasks_by_registration();

-- Approval is what makes any of it count, and content_categories lives here.
create trigger trg_auto_tasks_regs
after update of status, content_categories on clipathon.registrations
for each row when (new.status = 'approved')
execute function clipathon.touch_auto_tasks_registration();
