-- 052: console > Work Hours. Admins plan their day, clock in, and prove they are
-- actually working with random check-ins; the team report shows logged vs verified time.
--
-- New tables and functions only. Nothing existing is changed.
--
-- How a session works (all times server-side, days in India time, midnight to midnight):
--   * work_start: needs at least one task planned for today. Opens a session.
--   * Every 20-35 minutes (random) a check-in falls due. It counts as answered when
--       - the admin clicks "I'm here" within 5 minutes of it, or
--       - they used the console in the 10 minutes before it (up to the 5-minute window).
--   * An unanswered check-in is "missed": the time since the previous check-in is not
--     counted as worked. Two missed in a row end the session automatically, at the last
--     moment they were seen. So "log in, fall asleep, log out next morning" can't happen.
--   * work_stop: log out with an optional note.
--   Verified time = the spans that ended in an answered check-in, plus the stretch before
--   a manual log out. Logged time = log in to log out (or to the auto-end).
--
-- Settling is done lazily whenever any work_* function runs (no cron needed).
-- Tables have RLS on with no policies: every read and write goes through the
-- admin-only functions below.

begin;

create table public.work_sessions (
  id               bigserial primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  end_reason       text check (end_reason in ('logout', 'no_response')),
  last_activity_at timestamptz,
  summary          text check (summary is null or length(summary) <= 2000)
);
create unique index work_sessions_one_open on public.work_sessions(user_id) where ended_at is null;
create index work_sessions_user_started on public.work_sessions(user_id, started_at desc);

create table public.work_checks (
  id          bigserial primary key,
  session_id  bigint not null references public.work_sessions(id) on delete cascade,
  due_at      timestamptz not null,
  answered_at timestamptz,
  status      text not null default 'pending' check (status in ('pending', 'ok', 'missed')),
  via         text check (via in ('prompt', 'activity'))
);
create index work_checks_session_due on public.work_checks(session_id, due_at);

create table public.work_tasks (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  work_day   date not null,
  title      text not null check (length(btrim(title)) between 1 and 300),
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index work_tasks_user_day on public.work_tasks(user_id, work_day);

alter table public.work_sessions enable row level security;
alter table public.work_checks   enable row level security;
alter table public.work_tasks    enable row level security;
revoke all on public.work_sessions, public.work_checks, public.work_tasks from anon, authenticated;

create or replace function public.cx_ist_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- 20 to 35 minutes, random, so check-ins can't be predicted.
create or replace function public.cx_work_gap()
returns interval language sql volatile as $$ select make_interval(secs => 1200 + floor(random() * 900)::int) $$;

-- Brings a user's open session up to date: answers check-ins covered by console
-- activity, marks missed ones, ends the session after two misses in a row.
create or replace function public.cx_work_settle(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.work_sessions; c public.work_checks; prev text; last_seen timestamptz;
begin
  select * into s from public.work_sessions where user_id = p_user and ended_at is null for update;
  if not found then return; end if;
  loop
    select * into c from public.work_checks where session_id = s.id and status = 'pending' order by due_at limit 1;
    if not found then
      insert into public.work_checks(session_id, due_at) values (s.id, now() + public.cx_work_gap());
      exit;
    end if;
    exit when c.due_at > now();
    if s.last_activity_at is not null
       and s.last_activity_at >= c.due_at - interval '10 minutes'
       and s.last_activity_at <= c.due_at + interval '5 minutes' then
      update public.work_checks set status = 'ok', via = 'activity', answered_at = s.last_activity_at where id = c.id;
      insert into public.work_checks(session_id, due_at) values (s.id, c.due_at + public.cx_work_gap());
    elsif now() > c.due_at + interval '5 minutes' then
      update public.work_checks set status = 'missed' where id = c.id;
      select status into prev from public.work_checks
       where session_id = s.id and id <> c.id and status <> 'pending' and due_at < c.due_at
       order by due_at desc limit 1;
      if prev = 'missed' then
        select greatest(s.started_at, coalesce(max(answered_at), s.started_at), coalesce(s.last_activity_at, s.started_at))
          into last_seen from public.work_checks where session_id = s.id and status = 'ok';
        update public.work_sessions set ended_at = least(last_seen, now()), end_reason = 'no_response' where id = s.id;
        delete from public.work_checks where session_id = s.id and status = 'pending';
        exit;
      end if;
      insert into public.work_checks(session_id, due_at) values (s.id, c.due_at + interval '5 minutes' + public.cx_work_gap());
    else
      exit;  -- due now, waiting for an answer
    end if;
  end loop;
end $$;

-- One row per session: logged and verified seconds, check-ins answered and missed.
create or replace function public.cx_work_session_stats(p_user uuid, p_from date, p_to date)
returns table (session_id bigint, day date, started_at timestamptz, ended_at timestamptz, end_reason text,
               summary text, logged int, verified int, ok int, missed int)
language sql stable security definer set search_path = public as $$
  with s as (
    select * from public.work_sessions ws
     where ws.user_id = p_user and (ws.started_at at time zone 'Asia/Kolkata')::date between p_from and p_to),
  pts as (
    select c.session_id, c.due_at, c.status,
           coalesce(lag(c.due_at) over (partition by c.session_id order by c.due_at), s.started_at) as from_at
      from public.work_checks c join s on s.id = c.session_id
     where c.status <> 'pending')
  select s.id, (s.started_at at time zone 'Asia/Kolkata')::date, s.started_at, s.ended_at, s.end_reason, s.summary,
         extract(epoch from coalesce(s.ended_at, now()) - s.started_at)::int,
         (coalesce((select sum(extract(epoch from p.due_at - p.from_at)) from pts p where p.session_id = s.id and p.status = 'ok'), 0)
          + case when s.end_reason = 'logout' then greatest(0, extract(epoch from s.ended_at -
                   coalesce((select max(p.due_at) from pts p where p.session_id = s.id), s.started_at)))
                 else 0 end)::int,
         (select count(*) from pts p where p.session_id = s.id and p.status = 'ok')::int,
         (select count(*) from pts p where p.session_id = s.id and p.status = 'missed')::int
    from s order by s.started_at
$$;

create or replace function public.work_state()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.work_sessions; c public.work_checks;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.cx_work_settle(uid);
  select * into s from public.work_sessions where user_id = uid and ended_at is null;
  if s.id is not null then
    select * into c from public.work_checks where session_id = s.id and status = 'pending' order by due_at limit 1;
  end if;
  return jsonb_build_object(
    'now', now(),
    'today', public.cx_ist_today(),
    'session', case when s.id is null then null
                    else jsonb_build_object('id', s.id, 'started_at', s.started_at) end,
    'check', case when c.id is not null and c.due_at <= now()
                  then jsonb_build_object('id', c.id, 'due_at', c.due_at, 'closes_at', c.due_at + interval '5 minutes') end,
    'last_ended', (select jsonb_build_object('started_at', w.started_at, 'ended_at', w.ended_at, 'reason', w.end_reason)
                     from public.work_sessions w where w.user_id = uid and w.ended_at is not null
                    order by w.ended_at desc limit 1),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'done', t.done_at is not null) order by t.id)
                         from public.work_tasks t where t.user_id = uid and t.work_day = public.cx_ist_today()), '[]'::jsonb),
    'carry', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'day', t.work_day) order by t.work_day, t.id)
                         from public.work_tasks t where t.user_id = uid and t.done_at is null
                          and t.work_day between public.cx_ist_today() - 7 and public.cx_ist_today() - 1), '[]'::jsonb),
    'totals', (select jsonb_build_object('logged', coalesce(sum(x.logged), 0), 'verified', coalesce(sum(x.verified), 0),
                                         'ok', coalesce(sum(x.ok), 0), 'missed', coalesce(sum(x.missed), 0))
                 from public.cx_work_session_stats(uid, public.cx_ist_today(), public.cx_ist_today()) x));
end $$;

create or replace function public.work_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid bigint;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.cx_work_settle(uid);
  if not exists (select 1 from public.work_sessions where user_id = uid and ended_at is null) then
    if not exists (select 1 from public.work_tasks where user_id = uid and work_day = public.cx_ist_today() and done_at is null) then
      raise exception 'Plan at least one task for today before you start.' using errcode = 'P0001';
    end if;
    insert into public.work_sessions(user_id, last_activity_at) values (uid, now()) returning id into sid;
    insert into public.work_checks(session_id, due_at) values (sid, now() + public.cx_work_gap());
  end if;
  return public.work_state();
end $$;

create or replace function public.work_activity()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.work_sessions set last_activity_at = now() where user_id = auth.uid() and ended_at is null;
  return public.work_state();
end $$;

create or replace function public.work_answer(p_check bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); s public.work_sessions; n int;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into s from public.work_sessions where user_id = uid and ended_at is null for update;
  if s.id is not null then
    update public.work_checks set status = 'ok', via = 'prompt', answered_at = now()
     where id = p_check and session_id = s.id and status = 'pending'
       and now() between due_at and due_at + interval '5 minutes';
    get diagnostics n = row_count;
    if n = 1 then
      insert into public.work_checks(session_id, due_at) values (s.id, now() + public.cx_work_gap());
      update public.work_sessions set last_activity_at = now() where id = s.id;
    end if;
  end if;
  return public.work_state();
end $$;

create or replace function public.work_stop(p_summary text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.cx_work_settle(uid);
  update public.work_sessions set ended_at = now(), end_reason = 'logout',
         summary = nullif(left(btrim(coalesce(p_summary, '')), 2000), '')
   where user_id = uid and ended_at is null;
  delete from public.work_checks c using public.work_sessions s
   where c.session_id = s.id and s.user_id = uid and c.status = 'pending';
  return public.work_state();
end $$;

create or replace function public.work_task_add(p_title text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'Write the task first.' using errcode = 'P0001'; end if;
  insert into public.work_tasks(user_id, work_day, title) values (auth.uid(), public.cx_ist_today(), left(btrim(p_title), 300));
  return public.work_state();
end $$;

-- p_action: 'done', 'undo', 'today' (move an unfinished task to today), 'delete'
create or replace function public.work_task_set(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action = 'done' then
    update public.work_tasks set done_at = now() where id = p_id and user_id = uid and done_at is null;
  elsif p_action = 'undo' then
    update public.work_tasks set done_at = null where id = p_id and user_id = uid;
  elsif p_action = 'today' then
    update public.work_tasks set work_day = public.cx_ist_today() where id = p_id and user_id = uid and done_at is null;
  elsif p_action = 'delete' then
    delete from public.work_tasks where id = p_id and user_id = uid;
  else
    raise exception 'Unknown action.' using errcode = 'P0001';
  end if;
  return public.work_state();
end $$;

-- Every admin, day by day (India time), newest first.
create or replace function public.work_report(p_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d_to date := public.cx_ist_today(); d_from date := public.cx_ist_today() - greatest(1, least(coalesce(p_days, 14), 90)) + 1;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.cx_work_settle(a.user_id) from public.admin_users a where a.user_id is not null;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', a.user_id,
      'name', coalesce(nullif(p.full_name, ''), split_part(coalesce(p.email, a.email, ''), '@', 1)),
      'me', a.user_id = auth.uid(),
      'days', coalesce((
        select jsonb_agg(jsonb_build_object(
          'day', dd.day,
          'sessions', coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at)
                                  from public.cx_work_session_stats(a.user_id, dd.day, dd.day) x), '[]'::jsonb),
          'tasks', coalesce((select jsonb_agg(jsonb_build_object('title', t.title, 'done', t.done_at is not null) order by t.id)
                               from public.work_tasks t where t.user_id = a.user_id and t.work_day = dd.day), '[]'::jsonb))
          order by dd.day desc)
        from (select generate_series(d_from, d_to, interval '1 day')::date as day) dd), '[]'::jsonb))
      order by (a.user_id = auth.uid()) desc, p.full_name)
    from (select distinct on (user_id) user_id, email from public.admin_users where user_id is not null) a
    left join public.profiles p on p.id = a.user_id), '[]'::jsonb);
end $$;

revoke execute on function public.cx_work_settle(uuid) from public, anon, authenticated;
revoke execute on function public.cx_work_session_stats(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.cx_work_gap() from public, anon, authenticated;
revoke execute on function public.work_state(), public.work_start(), public.work_activity(), public.work_answer(bigint),
                           public.work_stop(text), public.work_task_add(text), public.work_task_set(bigint, text),
                           public.work_report(int) from public, anon;
grant  execute on function public.work_state(), public.work_start(), public.work_activity(), public.work_answer(bigint),
                           public.work_stop(text), public.work_task_add(text), public.work_task_set(bigint, text),
                           public.work_report(int) to authenticated;

commit;
