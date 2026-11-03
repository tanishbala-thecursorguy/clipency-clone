-- 061: extra videos posted on one day shorten the rest of the schedule.
--
-- cx_cal_state() took only today's planned videos off what was left, so a creator who
-- posted 7 in a day (2 planned) still had the other 5 scheduled on later days and a
-- last day that was too late. Counts, reminders and the pause notice were already
-- right; only the listed days change. Same signature, so callers are unchanged.

create or replace function public.cx_cal_state(p_plan bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
    v := least(p.per_day, n);
    sched := sched || jsonb_build_object(
      'day', d, 'videos', v, 'posted', case when d = today then least(today_n, v) else 0 end,
      'slots', case when p.style = 'reaction'
                    then case when v >= 2 then '["10 AM – 12 PM", "7 PM – 9 PM"]'::jsonb else '["7 PM – 9 PM"]'::jsonb end
                    else '["Before 9 PM"]'::jsonb end);
    -- extra videos posted today (beyond today's slot) come off the days after
    n := n - case when d = today then greatest(v, today_n) else v end; d := d + 1; k := k + 1;
  end loop;
  return jsonb_build_object(
    'plan_id', p.id, 'style', p.style, 'per_day', p.per_day, 'target', p.target, 'status', p.status,
    'start_date', p.start_date, 'today', today,
    'done', least(p.target, p.done_before + before_today + today_n),
    'remaining', greatest(0, p.target - p.done_before - before_today - today_n),
    'today_posted', today_n,
    'today_planned', case when today >= p.start_date then least(p.per_day, rem) else 0 end,
    'schedule', sched);
end $$;
