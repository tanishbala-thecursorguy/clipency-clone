-- 057: content calendar with daily email reminders (Octupie first).
--
-- A plan says: this creator posts N videos a day on this campaign until they reach a
-- target. Days and times are India time.
--   talking  : 1 video a day, posted before 9 PM. Reminder at 7 PM.
--   reaction : 2 videos a day, one 10 AM-12 PM, one 7-9 PM. Reminders at 10 AM and 7 PM.
-- done = done_before (videos posted before start_date, from the team's sheet) + videos
-- submitted on Clipency since start_date. A day's videos = the most clips submitted on
-- any one platform that day (the same video goes to Instagram and YouTube).
-- A reminder only goes out while that day's video(s) are still missing. The first
-- email is an intro with the dates; when the target is reached the creator gets one
-- "pause now" email and the plan is marked done.
--
-- New tables and functions only. Sending runs through the creator-reminders edge
-- function, called by cal_kick(). The pg_cron job that runs cal_kick is created
-- separately (058) once the test email has been checked.

begin;

create table public.cal_plans (
  id          bigserial primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null,
  style       text not null check (style in ('talking', 'reaction')),
  per_day     int  not null check (per_day between 1 and 4),
  target      int  not null check (target between 1 and 200),
  done_before int  not null default 0 check (done_before >= 0),
  start_date  date not null,
  status      text not null default 'active' check (status in ('active', 'paused', 'done')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create table public.cal_sends (
  id          bigserial primary key,
  plan_id     bigint not null references public.cal_plans(id) on delete cascade,
  kind        text not null check (kind in ('intro', 'morning', 'evening', 'pause')),
  for_day     date not null,
  email       text,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (plan_id, kind, for_day)
);
alter table public.cal_plans enable row level security;
alter table public.cal_sends enable row level security;
revoke all on public.cal_plans, public.cal_sends from anon, authenticated;

-- Videos per India day since the plan started.
create or replace function public.cx_cal_posted(p_plan bigint)
returns table (day date, videos int)
language sql stable security definer set search_path = public as $$
  select x.d, max(x.n)::int from (
    select (s.created_at at time zone 'Asia/Kolkata')::date d, s.platform, count(*) n
      from public.clip_submissions s join public.cal_plans p on p.id = p_plan
     where s.user_id = p.user_id and s.campaign_id::text = p.campaign_id::text and s.status <> 'rejected'
       and (s.created_at at time zone 'Asia/Kolkata')::date >= p.start_date
     group by 1, 2) x
  group by x.d
$$;

-- Progress and the day-by-day schedule from today on.
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
    n := n - v; d := d + 1; k := k + 1;
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

-- Which emails are due right now (read only).
create or replace function public.cx_cal_due()
returns table (plan_id bigint, kind text)
language sql stable security definer set search_path = public as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::time tm, public.cx_ist_today() d),
  s as (select p.id, p.style, public.cx_cal_state(p.id) st from public.cal_plans p, t
         where p.status = 'active' and p.start_date <= t.d),
  sent as (select c.plan_id, c.kind, c.for_day from public.cal_sends c)
  select s.id, k.kind from s cross join t
   cross join (values ('intro'), ('pause'), ('morning'), ('evening')) k(kind)
   where case k.kind
     when 'intro' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int > 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
     when 'pause' then t.tm between '08:00' and '21:59' and (s.st->>'remaining')::int <= 0
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'pause')
     when 'morning' then s.style = 'reaction' and t.tm between '10:00' and '11:59'
          and (s.st->>'today_posted')::int < 1 and (s.st->>'today_planned')::int >= 2
          and exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'morning' and sent.for_day = t.d)
     when 'evening' then t.tm between '19:00' and '20:59'
          and (s.st->>'today_posted')::int < (s.st->>'today_planned')::int
          and exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'intro')
          and not exists (select 1 from sent where sent.plan_id = s.id and sent.kind = 'evening' and sent.for_day = t.d)
   end
$$;

-- Edge function: claims the due emails (one row each, never twice) with what to say.
create or replace function public.cal_claim()
returns table (send_id bigint, kind text, email text, first_name text, label text, campaign text, state jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with ins as (
    insert into public.cal_sends (plan_id, kind, for_day, email)
    select d.plan_id, d.kind, public.cx_ist_today(), u.email
      from public.cx_cal_due() d join public.cal_plans p on p.id = d.plan_id join auth.users u on u.id = p.user_id
    on conflict do nothing
    returning cal_sends.id, cal_sends.plan_id, cal_sends.kind, cal_sends.email)
  select ins.id, ins.kind, ins.email,
         coalesce(nullif(pr.first_name, ''), nullif(split_part(coalesce(pr.full_name, ''), ' ', 1), ''), p.label),
         p.label, c.title, public.cx_cal_state(p.id)
    from ins join public.cal_plans p on p.id = ins.plan_id join public.campaigns c on c.id = p.campaign_id
    left join public.profiles pr on pr.id = p.user_id;
  update public.cal_plans pl set status = 'done', updated_at = now()
   where pl.status = 'active' and exists (select 1 from public.cal_sends cs where cs.plan_id = pl.id and cs.kind = 'pause');
end $$;

create or replace function public.cal_mark(p_id bigint, p_ok boolean, p_provider_id text, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.cal_sends set status = case when p_ok then 'sent' else 'failed' end,
         provider_id = p_provider_id, error = left(p_error, 500), sent_at = case when p_ok then now() end
   where id = p_id
$$;

create or replace function public.cal_kick()
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $$
declare key text; req bigint;
begin
  if not exists (select 1 from public.cx_cal_due()) then return null; end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'cal_kick: service_role_key missing'; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/creator-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('mode', 'run'),
    timeout_milliseconds := 60000) into req;
  return req;
end $$;

-- Creator dashboard: my calendars.
create or replace function public.my_content_calendar()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.cx_cal_state(p.id) || jsonb_build_object('campaign', c.title, 'label', p.label) order by p.id), '[]'::jsonb)
    from public.cal_plans p join public.campaigns c on c.id = p.campaign_id
   where p.user_id = auth.uid() and p.status <> 'paused'
$$;

-- Console: every plan with progress and its recent emails.
create or replace function public.admin_content_calendar()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(public.cx_cal_state(p.id) || jsonb_build_object(
      'campaign_id', p.campaign_id, 'campaign', c.title, 'user_id', p.user_id, 'label', p.label,
      'done_before', p.done_before, 'email', u.email,
      'name', coalesce(nullif(pr.full_name, ''), split_part(u.email, '@', 1)),
      'sends', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'day', s.for_day, 'status', s.status, 'at', coalesce(s.sent_at, s.created_at), 'error', s.error) order by s.created_at desc)
                           from (select * from public.cal_sends s where s.plan_id = p.id order by s.created_at desc limit 8) s), '[]'::jsonb))
      order by c.title, p.style, p.label)
      from public.cal_plans p join public.campaigns c on c.id = p.campaign_id
      join auth.users u on u.id = p.user_id left join public.profiles pr on pr.id = p.user_id), '[]'::jsonb);
end $$;

-- Console: add or edit a plan (admins). per_day follows the style.
create or replace function public.admin_cal_save(p_id bigint, p_campaign uuid, p_user uuid, p_label text, p_style text,
                                                 p_target int, p_done_before int, p_status text, p_start date)
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_style not in ('talking', 'reaction') then raise exception 'Pick talking or reaction.' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.cal_plans (campaign_id, user_id, label, style, per_day, target, done_before, start_date, status)
    values (p_campaign, p_user, btrim(p_label), p_style, case when p_style = 'reaction' then 2 else 1 end,
            p_target, coalesce(p_done_before, 0), coalesce(p_start, public.cx_ist_today()), coalesce(p_status, 'active'))
    returning id into rid;
  else
    update public.cal_plans set label = coalesce(nullif(btrim(p_label), ''), label), style = p_style,
           per_day = case when p_style = 'reaction' then 2 else 1 end, target = p_target,
           done_before = coalesce(p_done_before, done_before), status = coalesce(p_status, status),
           start_date = coalesce(p_start, start_date), updated_at = now()
     where id = p_id returning id into rid;
  end if;
  return rid;
end $$;

-- Console: creators approved for a campaign who have no plan on it yet.
create or replace function public.admin_cal_candidates(p_campaign uuid)
returns table (user_id uuid, email text, name text, handles text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select a.user_id, u.email::text, coalesce(nullif(pr.full_name, ''), split_part(u.email, '@', 1)),
         string_agg(distinct '@' || a.handle, ' · ')
    from public.campaign_applications ap join public.connected_accounts a on a.id = ap.connected_account_id
    join auth.users u on u.id = a.user_id left join public.profiles pr on pr.id = a.user_id
   where ap.campaign_id = p_campaign and ap.status = 'approved'
     and not exists (select 1 from public.cal_plans p where p.campaign_id = p_campaign and p.user_id = a.user_id)
   group by a.user_id, u.email, pr.full_name
   order by 3;
end $$;

revoke execute on function public.cx_cal_posted(bigint), public.cx_cal_state(bigint), public.cx_cal_due(),
                           public.cal_claim(), public.cal_mark(bigint, boolean, text, text), public.cal_kick()
  from public, anon, authenticated;
revoke execute on function public.my_content_calendar(), public.admin_content_calendar(),
                           public.admin_cal_save(bigint, uuid, uuid, text, text, int, int, text, date),
                           public.admin_cal_candidates(uuid) from public, anon;
grant  execute on function public.my_content_calendar(), public.admin_content_calendar(),
                           public.admin_cal_save(bigint, uuid, uuid, text, text, int, int, text, date),
                           public.admin_cal_candidates(uuid) to authenticated;

-- Octupie, from the team's sheet (2026-11-03). Start 3 Nov 2026.
--   talking, 8 videos: the 8 old creators still short of 8, and the new talking-head creators
--   reaction, 15 videos: the reaction-style creators
-- dishu.finds has no Clipency account yet; add her from the console once she does.
insert into public.cal_plans (campaign_id, user_id, label, style, per_day, target, done_before, start_date)
select c.id, v.uid::uuid, v.label, v.style, case when v.style = 'reaction' then 2 else 1 end, v.target, v.done, date '2026-11-03'
  from public.campaigns c,
  (values
    ('601a2d3e-a203-4d7c-b752-449a0edf1ae9', 'kash.iunfiltered',    'talking',   8, 7),
    ('0938cb7f-eaf0-4f30-80d1-c33a9f09268c', 'justarjiii',          'talking',   8, 7),
    ('0f95efa0-5581-4f44-9171-2fb95efbbf28', 'dishaaaoncam',        'talking',   8, 7),
    ('ffbdb221-7925-4fe2-9d67-92fd2bcd0a92', 'madebymanas_',        'talking',   8, 7),
    ('353fc531-25f0-4df1-8f03-9910df5c836f', 'pawan.heic',          'talking',   8, 5),
    ('a56c2e07-a078-4917-a16b-ca9b5b3164a2', 'prathamunfiltereddd', 'talking',   8, 6),
    ('9b5565b3-2af7-465f-af57-30146167315b', 'yapping.with.dev',    'talking',   8, 3),
    ('c292f0cb-df53-4f07-b495-4d6630ad606e', 'arzoo.finds',         'talking',   8, 4),
    ('05c0b72c-11dc-4eae-a8c5-0ba0190986ca', 'ronakfoundit',        'talking',   8, 0),
    ('23debe0b-223b-42ef-8958-7fff32563271', 'anup.picks',          'talking',   8, 0),
    ('a5f72522-1cd6-44d2-97a5-7da5529608ac', 'shikha_explains',     'talking',   8, 0),
    ('512addce-d94c-4ae0-a904-dc7781f79e73', 'sonamexploring',      'talking',   8, 0),
    ('abbde415-7ab7-48d3-b422-628fc85e8be9', 'mercyyreccomendss',   'reaction', 15, 6),
    ('fe12489e-623c-469b-a8df-c2b7c8c7b20a', 'jyotsnas_corner',     'reaction', 15, 3),
    ('ae1b53d8-3363-4895-a279-cc528e613672', 'narayani.talks',      'reaction', 15, 6),
    ('9f4bff48-a524-4e94-85dc-b46f622d13fb', 'justttt.aveee',       'reaction', 15, 0),
    ('7eb458a5-016d-49e6-a688-f2e5ab413842', 'khusi.finds',         'reaction', 15, 3),
    ('fb071d6f-bb57-4fc1-82f0-a36237e69753', 'pinaki.talks',        'reaction', 15, 0),
    ('5b70ce44-d195-43c3-aa69-06c0eda51a4a', 'itz_chhayascorner',   'reaction', 15, 2),
    ('34bba860-fa09-47d5-84b3-bd60d72646b8', 'arijitmakes_sense',   'reaction', 15, 5)
  ) as v(uid, label, style, target, done)
 where c.title ilike 'Octupie%';

commit;
