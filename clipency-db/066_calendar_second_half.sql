-- 066: posting plans in two halves, and a "Start second half" button.
--
-- Owner's rule: a campaign runs in two halves. Talking-head creators post 8 videos,
-- get the pause email, and wait; reaction creators do the same at 15. When the owner
-- presses "Start second half", the plan picks up again until the full count:
-- talking head 15 in all (7 more), reaction 30 in all (15 more). The second half
-- gets its own intro email, reminders and pause email; counting simply continues.
--
-- cal_plans.half (1 or 2) says which half a plan is in; cal_sends.half records which
-- half each email belonged to, so the first half's intro/pause don't block the
-- second's. Every existing plan and email is half 1, so nothing changes for them
-- until the button is pressed.

begin;

alter table public.cal_plans add column half smallint not null default 1 check (half in (1, 2));
alter table public.cal_sends add column half smallint not null default 1 check (half in (1, 2));
alter table public.cal_sends drop constraint cal_sends_plan_id_kind_for_day_key;
alter table public.cal_sends add constraint cal_sends_plan_half_kind_day_key unique (plan_id, half, kind, for_day);

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
    'start_date', p.start_date, 'today', today, 'half', p.half,
    'done', least(p.target, p.done_before + before_today + today_n),
    'remaining', greatest(0, p.target - p.done_before - before_today - today_n),
    'today_posted', today_n,
    'today_planned', case when today >= p.start_date then least(p.per_day, rem) else 0 end,
    'schedule', sched);
end $$;

create or replace function public.cx_cal_due()
returns table (plan_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::time tm, public.cx_ist_today() d),
  s as (select p.id, p.style, p.half, public.cx_cal_state(p.id) st from public.cal_plans p, t
         where p.status = 'active' and p.start_date <= t.d),
  sent as (select c.plan_id, c.half, c.kind, c.for_day from public.cal_sends c)
  select s.id, k.kind from s cross join t
   cross join (values ('intro'), ('pause'), ('morning'), ('evening'), ('late'), ('last')) k(kind)
   where case k.kind
     when 'intro' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int > 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
     when 'pause' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int <= 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'pause')
     when 'morning' then s.style = 'reaction' and t.tm between '10:00' and '11:59'
          and (s.st->>'today_posted')::int < 1 and (s.st->>'today_planned')::int >= 2
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'morning' and sent.for_day = t.d)
     else (case k.kind when 'evening' then t.tm between '18:00' and '19:59'
                       when 'late'    then t.tm between '20:00' and '20:59'
                       else s.style = 'reaction' and t.tm between '21:00' and '21:59' end)
          and (s.st->>'today_posted')::int < (s.st->>'today_planned')::int
          and exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = k.kind and sent.for_day = t.d)
   end
$$;

create or replace function public.cal_claim()
returns table (send_id bigint, kind text, email text, first_name text, label text, campaign text, state jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with ins as (
    insert into public.cal_sends (plan_id, half, kind, for_day, email)
    select d.plan_id, p.half, d.kind, public.cx_ist_today(), u.email
      from public.cx_cal_due() d join public.cal_plans p on p.id = d.plan_id join auth.users u on u.id = p.user_id
    on conflict do nothing
    returning cal_sends.id, cal_sends.plan_id, cal_sends.kind, cal_sends.email)
  select ins.id, ins.kind, ins.email,
         coalesce(nullif(pr.first_name, ''), nullif(split_part(coalesce(pr.full_name, ''), ' ', 1), ''), p.label),
         p.label, c.title, public.cx_cal_state(p.id)
    from ins join public.cal_plans p on p.id = ins.plan_id join public.campaigns c on c.id = p.campaign_id
    left join public.profiles pr on pr.id = p.user_id;
  update public.cal_plans pl set status = 'done', updated_at = now()
   where pl.status = 'active' and exists (select 1 from public.cal_sends cs where cs.plan_id = pl.id and cs.half = pl.half and cs.kind = 'pause');
end $$;

-- Console: start a plan's second half (admins).
create or replace function public.admin_cal_second_half(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.cal_plans;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.cal_plans where id = p_id for update;
  if not found then raise exception 'No such plan.' using errcode = 'P0001'; end if;
  if p.half = 2 then raise exception 'The second half has already started.' using errcode = 'P0001'; end if;
  update public.cal_plans
     set half = 2, status = 'active', updated_at = now(),
         target = greatest(target, case when style = 'reaction' then 30 else 15 end)
   where id = p_id;
  return public.cx_cal_state(p_id);
end $$;
revoke execute on function public.admin_cal_second_half(bigint) from public, anon;
grant  execute on function public.admin_cal_second_half(bigint) to authenticated;

commit;
