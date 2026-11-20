-- 071: "finish by" deadline for Content Calendar plans, an "update" email, and a second
-- address for reminders (owner, 2026-11-20).
--
-- Owner: these Octupie creators are all reaction style now and must finish their videos
-- within 7 days (by Thu 26 Nov 2026, India time):
--   narayani.talks, arzoo.finds*, anweshainactive*, mercyyreccomendss, nirunotreal,
--   khusi.finds, itz_chhayascorner, jyotsnas_corner, arijitmakes_sense, pinaki.talks
--   * were talking head (7 videos); now reaction (2 a day, 15 videos, same round).
-- Pinaki's reminders also go to pinakiadhikari101@gmail.com (his login stays the same).
--
-- Mechanics:
--   cal_plans.end_date: each day's count = what is needed to finish by end_date, never less
--     than per_day (so 15 left over 7 days = 3 today, then 2 a day).
--   cal_plans.cc_email: an extra address every reminder for the plan is also sent to.
--   kind 'update': one email per round with the new calendar, when a deadline is set on a
--     plan that already had its intro.

begin;

alter table public.cal_plans add column end_date date;
alter table public.cal_plans add column cc_email text check (cc_email is null or cc_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

alter table public.cal_sends drop constraint cal_sends_kind_check;
alter table public.cal_sends add constraint cal_sends_kind_check
  check (kind in ('intro', 'warmup', 'update', 'morning', 'noon', 'evening', 'late', 'last', 'pause'));

create or replace function public.cx_cal_state(p_plan bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare p public.cal_plans; today date := public.cx_ist_today(); before_today int; today_n int;
        rem int; n int; d date; k int := 0; v int; sched jsonb := '[]'::jsonb;
begin
  select * into p from public.cal_plans where id = p_plan;
  if not found then return null; end if;
  select coalesce(sum(x.videos) filter (where x.day < today), 0), coalesce(sum(x.videos) filter (where x.day = today), 0)
    into before_today, today_n from public.cx_cal_posted(p_plan) x;
  rem := greatest(0, p.target - p.done_before - before_today);   -- still to post, counting today's
  d := greatest(today, p.start_date); n := rem;
  while n > 0 and k < 90 loop
    v := public.cx_cal_day_count(p.per_day, p.end_date, d, n);
    sched := sched || jsonb_build_object(
      'day', d, 'videos', v, 'posted', case when d = today then least(today_n, v) else 0 end,
      'slots', case when p.style = 'reaction'
                    then case when v >= 3 then '["10 AM – 12 PM", "7 PM – 9 PM", "Any time before 9 PM"]'::jsonb
                              when v >= 2 then '["10 AM – 12 PM", "7 PM – 9 PM"]'::jsonb
                              else '["7 PM – 9 PM"]'::jsonb end
                    else case when v >= 2 then '["Before 9 PM", "Before 9 PM"]'::jsonb else '["Before 9 PM"]'::jsonb end end);
    -- extra videos posted today (beyond today's slot) come off the days after
    n := n - case when d = today then greatest(v, today_n) else v end; d := d + 1; k := k + 1;
  end loop;
  return jsonb_build_object(
    'plan_id', p.id, 'style', p.style, 'per_day', p.per_day, 'target', p.target, 'status', p.status,
    'start_date', p.start_date, 'end_date', p.end_date, 'cc_email', p.cc_email, 'today', today, 'half', p.half,
    'done', least(p.target, p.done_before + before_today + today_n),
    'remaining', greatest(0, p.target - p.done_before - before_today - today_n),
    'today_posted', today_n,
    'today_planned', case when today >= p.start_date then public.cx_cal_day_count(p.per_day, p.end_date, today, rem) else 0 end,
    'schedule', sched);
end $function$;

-- Videos planned for day d with n still to post: per_day, or more when a deadline needs it.
create or replace function public.cx_cal_day_count(p_per_day int, p_end date, p_day date, p_left int)
returns int language sql immutable as $$
  select least(greatest(p_left, 0),
               greatest(p_per_day,
                        case when p_end is null then 0
                             else ceil(greatest(p_left, 0)::numeric / greatest(p_end - p_day + 1, 1))::int end))
$$;
revoke all on function public.cx_cal_day_count(int, date, date, int) from public, anon;
grant execute on function public.cx_cal_day_count(int, date, date, int) to authenticated, service_role;

-- 'update' email: once per round, when a deadline is set after the intro went out.
create or replace function public.cx_cal_due()
returns table (plan_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::time tm, public.cx_ist_today() d),
  s as (select p.id, p.style, p.half, p.start_date, p.warmup_days, p.end_date, public.cx_cal_state(p.id) st
          from public.cal_plans p, t
         where p.status = 'active' and p.start_date - p.warmup_days <= t.d),
  sent as (select c.plan_id, c.half, c.kind, c.for_day from public.cal_sends c)
  select s.id, k.kind from s cross join t
   cross join (values ('warmup'), ('intro'), ('update'), ('pause'), ('morning'), ('noon'), ('evening'), ('late'), ('last')) k(kind)
   where case k.kind
     when 'warmup' then s.warmup_days > 0 and t.d < s.start_date and t.tm between '08:00' and '21:59'
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'warmup')
     when 'intro' then t.d >= s.start_date and t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int > 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
     when 'update' then s.end_date is not null and t.d >= s.start_date and t.tm between '08:00' and '21:59'
          and (s.st->>'remaining')::int > 0
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro' and sent.for_day < t.d)
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'update')
     when 'pause' then t.d >= s.start_date and t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int <= 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'pause')
     when 'morning' then s.style = 'reaction' and t.tm between '10:00' and '11:29'
          and (s.st->>'today_posted')::int < 1 and (s.st->>'today_planned')::int >= 2
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'morning' and sent.for_day = t.d)
     when 'noon' then s.style = 'reaction' and t.tm between '11:30' and '11:59'
          and (s.st->>'today_posted')::int < 1 and (s.st->>'today_planned')::int >= 2
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'noon' and sent.for_day = t.d)
     else (case k.kind when 'evening' then t.tm between '18:00' and '19:59'
                       when 'late'    then t.tm between '20:00' and '20:59'
                       else s.style = 'reaction' and t.tm between '21:00' and '21:59' end)
          and (s.st->>'today_posted')::int < (s.st->>'today_planned')::int
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = k.kind and sent.for_day = t.d)
   end
$$;

-- The owner's list.
update public.cal_plans set style = 'reaction', per_day = 2, target = 15, updated_at = now()
 where id in (8, 44) and label in ('arzoo.finds', 'anweshainactive');
update public.cal_plans set end_date = date '2026-11-26', updated_at = now()
 where id in (15, 8, 44, 13, 59, 17, 19, 14, 20, 18) and status = 'active';
update public.cal_plans set cc_email = 'pinakiadhikari101@gmail.com', updated_at = now()
 where id = 18 and label = 'pinaki.talks';

commit;
