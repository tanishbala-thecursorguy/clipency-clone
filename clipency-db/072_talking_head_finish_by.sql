-- 072: talking-head creators get the same finish-by date as the reaction list (owner, 2026-11-20).
-- Every active talking-head plan must finish by Thu 26 Nov 2026 (India time). With 1 a day
-- this fits everyone, so no one's daily count goes up; they get the "calendar changed" email.
update public.cal_plans set end_date = date '2026-11-26', updated_at = now()
 where style = 'talking' and status = 'active' and end_date is null;
