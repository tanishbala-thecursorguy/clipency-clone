-- 062: evening reminders at 6, 8 and 9 PM instead of one at 7 PM.
--
-- Owner's rule: anyone who hasn't posted today's videos by the evening gets nudged to
-- post right now.
--   reaction creators: 10 AM (unchanged), then 6 PM, 8 PM and 9 PM
--   talking-head creators: 6 PM and 8 PM (their deadline is 9 PM)
-- Each goes only while today's planned videos are still missing, and at most once a
-- day per kind. 'evening' now means the 6 PM one; 'late' is 8 PM and 'last' is 9 PM.
-- Only cal_sends' allowed kinds widen and cx_cal_due() is replaced; cal_claim,
-- cal_kick and the 10-minute cron stay as they are.

begin;

alter table public.cal_sends drop constraint cal_sends_kind_check;
alter table public.cal_sends add constraint cal_sends_kind_check
  check (kind in ('intro', 'morning', 'evening', 'late', 'last', 'pause'));

create or replace function public.cx_cal_due()
returns table (plan_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::time tm, public.cx_ist_today() d),
  s as (select p.id, p.style, public.cx_cal_state(p.id) st from public.cal_plans p, t
         where p.status = 'active' and p.start_date <= t.d),
  sent as (select c.plan_id, c.kind, c.for_day from public.cal_sends c)
  select s.id, k.kind from s cross join t
   cross join (values ('intro'), ('pause'), ('morning'), ('evening'), ('late'), ('last')) k(kind)
   where case k.kind
     when 'intro' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int > 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
     when 'pause' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int <= 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'pause')
     when 'morning' then s.style = 'reaction' and t.tm between '10:00' and '11:59'
          and (s.st->>'today_posted')::int < 1 and (s.st->>'today_planned')::int >= 2
          and exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'morning' and sent.for_day = t.d)
     else (case k.kind when 'evening' then t.tm between '18:00' and '19:59'
                       when 'late'    then t.tm between '20:00' and '20:59'
                       else s.style = 'reaction' and t.tm between '21:00' and '21:59' end)
          and (s.st->>'today_posted')::int < (s.st->>'today_planned')::int
          and exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = k.kind and sent.for_day = t.d)
   end
$$;

commit;
