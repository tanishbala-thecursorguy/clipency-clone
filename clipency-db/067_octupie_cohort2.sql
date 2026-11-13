-- 067: Octupie cohort 2 (second half), from Sat 14 Nov 2026, India time.
--
-- Owner's list (2026-11-13): every creator below starts a fresh round on 14 Nov.
--   talking head, 1 video a day before 9 PM, 7 videos:
--     tarushifinds, harjot.bak_bak, kash.iunfiltered, justarjiii, madebymanas_,
--     pawan.heic, arzoo.finds, ronakfoundit, anup.picks*, dishu.finds, dishaaaoncam,
--     hersheysglitch, utkalikayaps, anweshainactive
--   reaction, 2 a day (one by 12 PM, one by 9 PM), 15 videos:
--     narayani.talks, mercyyreccomendss, nirunotreal (moved to reaction), khusi.finds,
--     itz_chhayascorner, jyotsnas_corner, arijitmakes_sense, pinaki.talks*
--   * anup.picks and pinaki.talks warm up for 4 days first: a "warm up" email on
--     14 Nov, and their posting starts on Wed 18 Nov.
-- Creators on the calendar but not on the list (yapping.with.dev, prathamunfiltereddd,
-- shikha_explains, sonamexploring, justttt.aveee) are paused: no more reminders.
--
-- Mechanics: each listed plan moves to half 2 with done_before 0 and a new start date,
-- so only videos from the start date count. New kinds: 'warmup' (once, during the
-- warm-up days) and 'noon' (reaction: 11:30 AM nudge while the morning video is still
-- missing, so it lands before 12 PM).

begin;

alter table public.cal_plans add column warmup_days int not null default 0 check (warmup_days between 0 and 14);
alter table public.cal_sends drop constraint cal_sends_kind_check;
alter table public.cal_sends add constraint cal_sends_kind_check
  check (kind in ('intro', 'warmup', 'morning', 'noon', 'evening', 'late', 'last', 'pause'));

create or replace function public.cx_cal_due()
returns table (plan_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::time tm, public.cx_ist_today() d),
  s as (select p.id, p.style, p.half, p.start_date, p.warmup_days, public.cx_cal_state(p.id) st
          from public.cal_plans p, t
         where p.status = 'active' and p.start_date - p.warmup_days <= t.d),
  sent as (select c.plan_id, c.half, c.kind, c.for_day from public.cal_sends c)
  select s.id, k.kind from s cross join t
   cross join (values ('warmup'), ('intro'), ('pause'), ('morning'), ('noon'), ('evening'), ('late'), ('last')) k(kind)
   where case k.kind
     when 'warmup' then s.warmup_days > 0 and t.d < s.start_date and t.tm between '08:00' and '21:59'
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'warmup')
     when 'intro' then t.d >= s.start_date and t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int > 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.half = s.half and sent.kind = 'intro')
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

-- The list.
with camp as (select id from public.campaigns where title ilike 'Octupie%' limit 1),
list(handle, style, start_on, warm) as (values
  ('tarushifinds',      'talking',  date '2026-11-14', 0),
  ('harjot.bak_bak',    'talking',  date '2026-11-14', 0),
  ('kash.iunfiltered',  'talking',  date '2026-11-14', 0),
  ('justarjiii',        'talking',  date '2026-11-14', 0),
  ('madebymanas_',      'talking',  date '2026-11-14', 0),
  ('pawan.heic',        'talking',  date '2026-11-14', 0),
  ('arzoo.finds',       'talking',  date '2026-11-14', 0),
  ('ronakfoundit',      'talking',  date '2026-11-14', 0),
  ('anup.picks',        'talking',  date '2026-11-18', 4),
  ('dishu.finds',       'talking',  date '2026-11-14', 0),
  ('dishaaaoncam',      'talking',  date '2026-11-14', 0),
  ('hersheysglitch',    'talking',  date '2026-11-14', 0),
  ('utkalikayaps',      'talking',  date '2026-11-14', 0),
  ('anweshainactive',   'talking',  date '2026-11-14', 0),
  ('narayani.talks',    'reaction', date '2026-11-14', 0),
  ('mercyyreccomendss', 'reaction', date '2026-11-14', 0),
  ('nirunotreal',       'reaction', date '2026-11-14', 0),
  ('khusi.finds',       'reaction', date '2026-11-14', 0),
  ('itz_chhayascorner', 'reaction', date '2026-11-14', 0),
  ('jyotsnas_corner',   'reaction', date '2026-11-14', 0),
  ('arijitmakes_sense', 'reaction', date '2026-11-14', 0),
  ('pinaki.talks',      'reaction', date '2026-11-18', 4)),
who as (select distinct on (l.handle) l.*, a.user_id
          from list l join public.connected_accounts a on lower(a.handle) = l.handle and a.platform ilike 'instagram'
         order by l.handle, a.status = 'verified' desc)
insert into public.cal_plans (campaign_id, user_id, label, style, per_day, target, done_before, start_date, status, half, warmup_days)
select camp.id, who.user_id, who.handle, who.style, case when who.style = 'reaction' then 2 else 1 end,
       case when who.style = 'reaction' then 15 else 7 end, 0, who.start_on, 'active', 2, who.warm
  from who, camp
on conflict (campaign_id, user_id) do update
   set label = excluded.label, style = excluded.style, per_day = excluded.per_day, target = excluded.target,
       done_before = 0, start_date = excluded.start_date, status = 'active', half = 2,
       warmup_days = excluded.warmup_days, updated_at = now();

update public.cal_plans set status = 'paused', updated_at = now()
 where label in ('yapping.with.dev', 'prathamunfiltereddd', 'shikha_explains', 'sonamexploring', 'justttt.aveee')
   and campaign_id = (select id from public.campaigns where title ilike 'Octupie%' limit 1);

commit;
