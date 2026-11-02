-- 053: three changes, applied together.
--
-- 1. Faster console. Command Center's "Last 14 days" read v_daily_activity, which
--    re-checks row security ~91 x 1,000 times and took 3.4 s (often timing out, so the
--    chart showed "No activity"). admin_daily_activity(p_days) returns the same columns
--    in one pass with one staff check (~20 ms). The view is left as it is.
--
-- 2. Work Hours: the clock runs until "Finish work". Missed check-ins no longer end
--    the session; they only mark that stretch as away from the desk.
--
-- 3. Promotions: at most 50 emails per sending inbox per India day (5 inboxes, so up to
--    250 a day), replacing the 150-a-day total. Every sent promo is looked up at Resend
--    about 30 minutes later and again after a day. A spam complaint, or bounces at 3+
--    and 5%+ of that inbox's last 3 days, pause that inbox for 3 days; its queued
--    emails wait and then continue. Resend can't see whether a mail landed in a spam
--    folder; complaints and bounces are the signals mailbox providers use to start
--    sending you there.
--
-- New: admin_daily_activity, promo_inbox_cap, promo_send_checks, promo_inbox_pauses,
--      promo_to_check, promo_note_event, promo_inbox_status.
-- Replaced: cx_work_settle (052), promo_batch and promo_kick (048).

begin;

-- 1 ------------------------------------------------------------------------------
create or replace function public.admin_daily_activity(p_days int default 14)
returns table (day date, new_signups bigint, submissions bigint, approvals bigint, rejections bigint,
               views_submitted numeric, payout_requests bigint, amount_paid numeric, active_users bigint)
language plpgsql stable security definer set search_path = public as $$
declare d0 date := current_date - greatest(1, least(coalesce(p_days, 14), 90)) + 1;
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  with days as (select g::date as d from generate_series(d0, current_date, interval '1 day') g),
  pr as (select created_at::date d, count(*) n from profiles where created_at >= d0 group by 1),
  cs as (select created_at::date d, count(*) n, coalesce(sum(views_count), 0)::numeric v
           from clip_submissions where created_at >= d0 group by 1),
  rv as (select reviewed_at::date d, count(*) filter (where status = 'approved') a,
                count(*) filter (where status = 'rejected') r
           from clip_submissions where reviewed_at >= d0 group by 1),
  rq as (select requested_at::date d, count(*) n from payout_requests where requested_at >= d0 group by 1),
  pd as (select paid_at::date d, coalesce(sum(amount), 0)::numeric s from payout_requests where paid_at >= d0 group by 1),
  lg as (select login_at::date d, count(distinct user_id) n from user_session_logs where login_at >= d0 group by 1)
  select days.d, coalesce(pr.n, 0), coalesce(cs.n, 0), coalesce(rv.a, 0), coalesce(rv.r, 0), coalesce(cs.v, 0),
         coalesce(rq.n, 0), coalesce(pd.s, 0), coalesce(lg.n, 0)
    from days
    left join pr on pr.d = days.d left join cs on cs.d = days.d left join rv on rv.d = days.d
    left join rq on rq.d = days.d left join pd on pd.d = days.d left join lg on lg.d = days.d
   order by days.d desc;
end $$;
revoke execute on function public.admin_daily_activity(int) from public, anon;
grant  execute on function public.admin_daily_activity(int) to authenticated;

-- 2 ------------------------------------------------------------------------------
create or replace function public.cx_work_settle(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.work_sessions; c public.work_checks;
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
      -- away from the desk: noted, the clock keeps running until "Finish work"
      update public.work_checks set status = 'missed' where id = c.id;
      -- next one follows on from this one, so a long absence becomes a run of missed
      -- stretches and answering on return only covers the last ~30 minutes
      insert into public.work_checks(session_id, due_at) values (s.id, c.due_at + interval '5 minutes' + public.cx_work_gap());
    else
      exit;
    end if;
  end loop;
end $$;
revoke execute on function public.cx_work_settle(uuid) from public, anon, authenticated;

-- 3 ------------------------------------------------------------------------------
create or replace function public.promo_inbox_cap()
returns int language sql immutable as $$ select 50 $$;

create table public.promo_send_checks (
  send_id    bigint primary key references public.promo_sends(id) on delete cascade,
  last_event text,
  checks     int not null default 0,
  checked_at timestamptz not null default now()
);
create table public.promo_inbox_pauses (
  id           bigserial primary key,
  from_email   text not null,
  paused_until timestamptz not null,
  reason       text not null,
  created_at   timestamptz not null default now()
);
create index promo_inbox_pauses_inbox on public.promo_inbox_pauses(from_email, paused_until desc);
alter table public.promo_send_checks  enable row level security;
alter table public.promo_inbox_pauses enable row level security;
revoke all on public.promo_send_checks, public.promo_inbox_pauses from anon, authenticated;

create or replace function public.promo_ist_midnight()
returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata' $$;

-- Up to 50 per inbox per India day, skipping paused inboxes.
create or replace function public.promo_batch(p_limit int default 90)
returns table (id bigint, promo_id bigint, email text, first_name text, from_email text, token uuid,
               subject text, html text, text_body text)
language plpgsql security definer set search_path = public as $$
begin
  delete from promo_sends s using promo_unsubscribes x where s.status = 'queued' and x.email = s.email;
  update promo_emails e set status = 'sending', updated_at = now()
   where e.status = 'approved' and e.send_at <= now();
  return query
    with today as (
      select t.from_email, count(*)::int n from promo_sends t
       where t.status = 'sent' and t.sent_at >= promo_ist_midnight() group by 1),
    q as (
      select s.*, row_number() over (partition by s.from_email order by s.id) rn
        from promo_sends s join promo_emails e on e.id = s.promo_id
       where s.status = 'queued' and e.status = 'sending'
         and not exists (select 1 from promo_inbox_pauses p where p.from_email = s.from_email and p.paused_until > now()))
    select q.id, q.promo_id, q.email, q.first_name, q.from_email, q.token, e.subject, e.html, e.text_body
      from q join promo_emails e on e.id = q.promo_id
      left join today t on t.from_email = q.from_email
     where q.rn <= promo_inbox_cap() - coalesce(t.n, 0)
     order by q.id limit p_limit;
end $$;

-- Sent promos due a look-up at Resend: ~30 min after sending, then again after a day.
create or replace function public.promo_to_check(p_limit int default 6)
returns table (send_id bigint, provider_id text)
language sql stable security definer set search_path = public as $$
  select s.id, s.provider_id from promo_sends s
    left join promo_send_checks c on c.send_id = s.id
   where s.status = 'sent' and s.provider_id is not null
     and s.sent_at > now() - interval '3 days'
     and ((c.send_id is null and s.sent_at < now() - interval '30 minutes')
          or (c.checks = 1 and coalesce(c.last_event, '') not in ('bounced', 'complained')
              and s.sent_at < now() - interval '1 day'))
   order by s.sent_at limit p_limit
$$;

-- Records Resend's last event for a send; pauses that inbox for 3 days on a complaint
-- or a bounce spike.
create or replace function public.promo_note_event(p_send bigint, p_event text)
returns text language plpgsql security definer set search_path = public as $$
declare inbox text; sent3 int; bounced3 int; why text;
begin
  insert into promo_send_checks(send_id, last_event, checks, checked_at) values (p_send, p_event, 1, now())
  on conflict (send_id) do update set last_event = excluded.last_event, checks = promo_send_checks.checks + 1, checked_at = now();
  select from_email into inbox from promo_sends where id = p_send;
  if inbox is null then return null; end if;
  if p_event = 'complained' then
    why := 'A recipient marked an email as spam.';
  elsif p_event = 'bounced' then
    select count(*) into sent3 from promo_sends where from_email = inbox and status = 'sent' and sent_at > now() - interval '3 days';
    select count(*) into bounced3 from promo_sends s join promo_send_checks c on c.send_id = s.id
     where s.from_email = inbox and s.sent_at > now() - interval '3 days' and c.last_event = 'bounced';
    if bounced3 >= 3 and bounced3 >= 0.05 * greatest(sent3, 1) then
      why := bounced3 || ' of ' || sent3 || ' emails bounced in the last 3 days.';
    end if;
  end if;
  if why is not null and not exists (select 1 from promo_inbox_pauses where from_email = inbox and paused_until > now()) then
    insert into promo_inbox_pauses(from_email, paused_until, reason) values (inbox, now() + interval '3 days', why);
    return 'paused';
  end if;
  return null;
end $$;

-- Console > Promotions: today's count and any pause, per inbox.
create or replace function public.promo_inbox_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'inbox', i.inbox,
      'sent_today', (select count(*) from promo_sends s where s.from_email = i.inbox and s.status = 'sent' and s.sent_at >= promo_ist_midnight()),
      'cap', promo_inbox_cap(),
      'queued', (select count(*) from promo_sends s where s.from_email = i.inbox and s.status = 'queued'),
      'paused_until', (select max(p.paused_until) from promo_inbox_pauses p where p.from_email = i.inbox and p.paused_until > now()),
      'pause_reason', (select p.reason from promo_inbox_pauses p where p.from_email = i.inbox and p.paused_until > now() order by p.paused_until desc limit 1))
      order by i.inbox)
    from unnest(promo_senders()) as i(inbox)), '[]'::jsonb);
end $$;

-- Calls promo-emails when something can be sent, or when sends are due a look-up.
create or replace function public.promo_kick()
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $$
declare key text; req bigint;
begin
  if not exists (select 1 from promo_batch_preview())
     and not exists (select 1 from promo_to_check(1)) then
    return null;
  end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'promo_kick: service_role_key missing'; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/promo-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 60000) into req;
  return req;
end $$;

-- Read-only: is anything sendable right now (due, under the inbox cap, inbox not paused)?
create or replace function public.promo_batch_preview()
returns table (id bigint) language sql stable security definer set search_path = public as $$
  with today as (
    select t.from_email, count(*)::int n from promo_sends t
     where t.status = 'sent' and t.sent_at >= promo_ist_midnight() group by 1)
  select s.id from promo_sends s join promo_emails e on e.id = s.promo_id
    left join today t on t.from_email = s.from_email
   where s.status = 'queued' and e.status in ('approved', 'sending') and e.send_at <= now()
     and coalesce(t.n, 0) < promo_inbox_cap()
     and not exists (select 1 from promo_inbox_pauses p where p.from_email = s.from_email and p.paused_until > now())
   limit 1
$$;

revoke execute on function public.promo_batch(int), public.promo_kick(), public.promo_batch_preview(),
                           public.promo_to_check(int), public.promo_note_event(bigint, text)
  from public, anon, authenticated;
revoke execute on function public.promo_inbox_status() from public, anon;
grant  execute on function public.promo_inbox_status() to authenticated;

commit;
