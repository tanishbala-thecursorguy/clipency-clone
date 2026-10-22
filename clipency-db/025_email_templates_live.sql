-- 025 · All Clipency emails, on the Clipathon template.
--
-- Clients (each can switch these off in Profile):
--   review_milestone  "20 clips are waiting for your review"  sent when the
--                     waiting count reaches 10, 20, 30 ... for a campaign.
--                     Reaching 17 after 10 sends nothing. If the client works
--                     the queue down, the next climb past 10 sends again.
--                     Replaces the every-30-minutes new_clips email.
--   reminder          unchanged: 6 hours before a clip auto-approves.
--   weekly_report     Monday 9:00 in the client's own timezone: last week's
--                     views, approvals, live clips, spend so far, waiting,
--                     rejected, auto-approved, top 3 clips. Dashboard numbers.
-- Creators (transactional, always on):
--   clip_approved     every approval (pending or rejected -> approved).
--   clip_rejected     every rejection, with the reason and a 24-hour
--                     resubmit nudge (not enforced; Ayush, 30 Sep).
--   private_approved  application to a private campaign approved.
-- No email ever carries a creator rate, payout, fee or pool. The weekly
-- report's spend is the client's own billed spend, as on the dashboard.
--
-- Creator events go through email_outbox, written by triggers that can
-- never block the approval itself (any error is swallowed as a warning).

-- ---------- kinds, prefs, state ----------
alter table public.client_email_log drop constraint if exists client_email_log_kind_check;
alter table public.client_email_log add constraint client_email_log_kind_check
  check (kind in ('new_clips','review_milestone','reminder','weekly_report',
                  'clip_approved','clip_rejected','private_approved','test'));

alter table public.client_notify_prefs add column if not exists email_weekly boolean not null default true;

create table if not exists public.client_review_milestones (
  client_user_id uuid not null,
  campaign_id    uuid not null,
  last_milestone integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (client_user_id, campaign_id)
);
alter table public.client_review_milestones enable row level security;
revoke all on public.client_review_milestones from anon, authenticated;

create table if not exists public.email_outbox (
  id                bigint generated always as identity primary key,
  kind              text not null check (kind in ('clip_approved','clip_rejected','private_approved')),
  recipient_user_id uuid not null,
  submission_id     uuid,
  application_id    uuid,
  dedupe_key        text not null unique,
  event_at          timestamptz not null default now(),
  attempts          integer not null default 0,
  processed_at      timestamptz,
  log_id            bigint references public.client_email_log(id) on delete set null
);
create index if not exists idx_email_outbox_open on public.email_outbox (id) where processed_at is null;
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

-- ---------- events ----------
create or replace function public.cx_email_on_submission()
returns trigger language plpgsql security definer set search_path = public as $f$
begin
  begin
    if new.status = 'approved' and old.status in ('pending','rejected') then
      insert into public.email_outbox (kind, recipient_user_id, submission_id, dedupe_key)
      values ('clip_approved', new.user_id, new.id, 'clip_approved:' || new.id)
      on conflict (dedupe_key) do nothing;
    elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
      insert into public.email_outbox (kind, recipient_user_id, submission_id, dedupe_key)
      values ('clip_rejected', new.user_id, new.id,
              'clip_rejected:' || new.id || ':' || floor(extract(epoch from clock_timestamp())))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'cx_email_on_submission: %', sqlerrm;   -- never block a review
  end;
  return null;
end $f$;

drop trigger if exists trg_cx_email_on_submission on public.clip_submissions;
create trigger trg_cx_email_on_submission
  after update of status on public.clip_submissions
  for each row execute function public.cx_email_on_submission();

create or replace function public.cx_email_on_application()
returns trigger language plpgsql security definer set search_path = public as $f$
begin
  begin
    if new.status = 'approved' and old.status is distinct from 'approved'
       and exists (select 1 from public.campaigns c where c.id = new.campaign_id and coalesce(c.is_private, false)) then
      insert into public.email_outbox (kind, recipient_user_id, application_id, dedupe_key)
      values ('private_approved', new.user_id, new.id, 'private_approved:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'cx_email_on_application: %', sqlerrm;
  end;
  return null;
end $f$;

drop trigger if exists trg_cx_email_on_application on public.campaign_applications;
create trigger trg_cx_email_on_application
  after update of status on public.campaign_applications
  for each row execute function public.cx_email_on_application();

revoke all on function public.cx_email_on_submission() from public, anon, authenticated;
revoke all on function public.cx_email_on_application() from public, anon, authenticated;

-- ---------- client settings: add the weekly report switch ----------
drop function if exists public.client_set_notify_prefs(boolean, boolean, text, text);

create or replace function public.client_get_notify_prefs()
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare uid uuid := auth.uid(); p record; login text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;
  select email into login from auth.users where id = uid;
  select * into p from public.client_notify_prefs where client_user_id = uid;
  return jsonb_build_object(
    'email_new_clips', coalesce(p.email_new_clips, true),
    'email_reminders', coalesce(p.email_reminders, true),
    'email_weekly',    coalesce(p.email_weekly, true),
    'notify_email',    p.notify_email,
    'login_email',     login,
    'timezone',        coalesce(p.timezone, 'Asia/Kolkata'),
    'saved',           p.client_user_id is not null);
end $f$;

create or replace function public.client_set_notify_prefs(p_new_clips boolean, p_reminders boolean,
                                                          p_email text default null, p_timezone text default null,
                                                          p_weekly boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); e text := nullif(lower(btrim(coalesce(p_email, ''))), ''); tz text := nullif(btrim(coalesce(p_timezone, '')), '');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;
  if p_new_clips is null or p_reminders is null then raise exception 'choose on or off for each email'; end if;
  if e is not null and (length(e) > 254 or e !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'enter a valid email address';
  end if;
  if e = (select lower(email) from auth.users where id = uid) then e := null; end if;
  if tz is not null and not exists (select 1 from pg_timezone_names where name = tz) then tz := null; end if;
  insert into public.client_notify_prefs as p (client_user_id, email_new_clips, email_reminders, email_weekly, notify_email, timezone, updated_at)
  values (uid, p_new_clips, p_reminders, coalesce(p_weekly, true), e, coalesce(tz, 'Asia/Kolkata'), now())
  on conflict (client_user_id) do update
    set email_new_clips = excluded.email_new_clips,
        email_reminders = excluded.email_reminders,
        email_weekly    = coalesce(p_weekly, p.email_weekly),
        notify_email    = excluded.notify_email,
        timezone        = coalesce(tz, p.timezone),
        updated_at      = now();
  return public.client_get_notify_prefs();
end $f$;

revoke all on function public.client_set_notify_prefs(boolean, boolean, text, text, boolean) from public, anon;
grant execute on function public.client_set_notify_prefs(boolean, boolean, text, text, boolean) to authenticated;

-- ---------- helpers for the weekly report ----------
-- Views a clip had at a moment: the last measurement at or before it.
create or replace function public.cx_views_at(p_submission uuid, p_at timestamptz)
returns numeric language sql stable security definer set search_path = public as $f$
  select coalesce((select h.views from public.clip_metrics_history h
                    where h.submission_id = p_submission and h.captured_at <= p_at
                    order by h.captured_at desc limit 1), 0)
$f$;
revoke all on function public.cx_views_at(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.cx_weekly_payload(p_campaign uuid, p_tz text)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare
  c public.campaigns%rowtype; wk_end timestamptz; wk_start timestamptz; pv_start timestamptz;
  views_w numeric; views_p numeric; appr_w int; appr_p int; live int; creators int;
  spent numeric; waiting int; rej_w int; auto_w int; top jsonb; fx numeric; unit numeric; vtot numeric; trk int;
begin
  select * into c from public.campaigns where id = p_campaign;
  if not found then return null; end if;
  -- last Monday 00:00 in the client's timezone is the end of the reported week
  wk_end   := (date_trunc('week', now() at time zone p_tz)) at time zone p_tz;
  wk_start := wk_end - interval '7 days';
  pv_start := wk_start - interval '7 days';

  select coalesce(sum(greatest(cx_views_at(s.id, wk_end) - cx_views_at(s.id, wk_start), 0)), 0),
         coalesce(sum(greatest(cx_views_at(s.id, wk_start) - cx_views_at(s.id, pv_start), 0)), 0)
    into views_w, views_p
    from public.clip_submissions s
   where s.campaign_id = c.id::text and s.status = 'approved';

  -- all-time views (the dashboard's number) and how many clips are still being tracked
  select coalesce(sum(s.views_count), 0),
         count(*) filter (where exists (select 1 from public.clip_metrics_history h
                                         where h.submission_id = s.id and h.captured_at > wk_end - interval '2 days'))
    into vtot, trk
    from public.clip_submissions s
   where s.campaign_id = c.id::text and s.status = 'approved';

  select count(*) filter (where s.status = 'approved' and s.reviewed_at >= wk_start and s.reviewed_at < wk_end),
         count(*) filter (where s.status = 'approved' and s.reviewed_at >= pv_start and s.reviewed_at < wk_start),
         count(*) filter (where s.status = 'approved'),
         count(distinct s.user_id) filter (where s.status = 'approved'),
         count(*) filter (where s.status = 'pending'),
         count(*) filter (where s.status = 'rejected' and s.reviewed_at >= wk_start and s.reviewed_at < wk_end),
         count(*) filter (where s.review_source = 'auto' and s.reviewed_at >= wk_start and s.reviewed_at < wk_end)
    into appr_w, appr_p, live, creators, waiting, rej_w, auto_w
    from public.clip_submissions s where s.campaign_id = c.id::text;

  -- spend so far, billed at the client's rate: the dashboard's own formula
  fx := greatest(coalesce(c.fx_rate_per_usd, 1), 0.000001);
  unit := public.campaign_client_unit_rate(c);
  spent := case when coalesce(c.payout_model, 'per_view') = 'per_video' then live * unit
                else coalesce(c.budget_used, 0) / greatest(public.campaign_rate_ratio(c), 0.000001) end;

  select coalesce(jsonb_agg(t order by t.gain desc, t.views desc), '[]'::jsonb) into top
    from (select s.handle, s.platform, s.clip_url as url, coalesce(s.views_count, 0) as views, coalesce(s.likes, 0) as likes,
                 greatest(cx_views_at(s.id, wk_end) - cx_views_at(s.id, wk_start), 0) as gain
            from public.clip_submissions s
           where s.campaign_id = c.id::text and s.status = 'approved'
           order by gain desc, views desc limit 3) t;

  return jsonb_build_object(
    'campaign_id', c.id, 'campaign', c.title, 'timezone', p_tz,
    'week_start', wk_start, 'week_end', wk_end - interval '1 second',
    'views', views_w, 'views_prev', views_p, 'views_total', vtot, 'tracking', trk, 'approved', appr_w, 'approved_prev', appr_p,
    'live', live, 'creators', creators, 'waiting', waiting, 'rejected', rej_w, 'auto', auto_w,
    'currency', coalesce(c.currency, 'USD'), 'spent', round(spent, 2), 'budget', round(coalesce(c.budget, 0), 2),
    'top', top,
    'active_this_week', (views_w > 0 or appr_w > 0 or rej_w > 0 or waiting > 0));
end $f$;
revoke all on function public.cx_weekly_payload(uuid, text) from public, anon, authenticated;

-- Every client of every campaign, with their email settings.
create or replace function public.cx_email_recipients()
returns table (campaign_id uuid, title text, camp_status text, client_id uuid, to_email text,
               nc boolean, rm boolean, wk boolean, tz text, review_on boolean)
language sql stable security definer set search_path = public as $f$
  select c.id, c.title, c.status, u.id, coalesce(p.notify_email, u.email)::text,
         coalesce(p.email_new_clips, true), coalesce(p.email_reminders, true), coalesce(p.email_weekly, true),
         coalesce(p.timezone, 'Asia/Kolkata'), public.cx_client_review_on(c.id::text)
    from public.campaigns c
    join lateral (select c.client_user_id as uid
                  union select cc.client_user_id from public.campaign_clients cc where cc.campaign_id = c.id) x on x.uid is not null
    join auth.users u on u.id = x.uid
    left join public.client_notify_prefs p on p.client_user_id = u.id
$f$;
revoke all on function public.cx_email_recipients() from public, anon, authenticated;

-- ---------- the batch ----------
-- Replaces cx_client_email_batch. Returns [{id, kind, to, payload}] and logs each.
create or replace function public.cx_email_batch()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare r record; lid bigint; out jsonb := '[]'::jsonb; m int; lastm int; pl jsonb; o record; sb record; a record; to_addr text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cx_client_email_batch')) then return out; end if;

  -- A. every 10 waiting
  for r in
    select rc.*, count(s.id)::int as n, min(s.review_due_at) as first_due,
           bool_or(rc.camp_status is distinct from 'active') as paused
      from public.cx_email_recipients() rc
      left join public.clip_submissions s
        on s.campaign_id = rc.campaign_id::text and s.status = 'pending' and s.review_due_at is not null
     where rc.review_on and rc.to_email is not null
     group by rc.campaign_id, rc.title, rc.camp_status, rc.client_id, rc.to_email, rc.nc, rc.rm, rc.wk, rc.tz, rc.review_on
  loop
    m := (r.n / 10) * 10;
    select last_milestone into lastm from public.client_review_milestones
     where client_user_id = r.client_id and campaign_id = r.campaign_id;
    lastm := coalesce(lastm, 0);
    if m < lastm then
      update public.client_review_milestones set last_milestone = m, updated_at = now()
       where client_user_id = r.client_id and campaign_id = r.campaign_id;
    elsif m >= 10 and m > lastm and r.nc then
      insert into public.client_review_milestones (client_user_id, campaign_id, last_milestone)
      values (r.client_id, r.campaign_id, m)
      on conflict (client_user_id, campaign_id) do update set last_milestone = m, updated_at = now();
      pl := jsonb_build_object('campaign_id', r.campaign_id, 'campaign', r.title, 'count', r.n, 'milestone', m,
              'prev_milestone', lastm, 'first_due', r.first_due, 'timezone', r.tz, 'paused', r.paused,
              'window_hours', (select client_review_hours from public.campaigns where id = r.campaign_id),
              'clips', (select coalesce(jsonb_agg(jsonb_build_object('handle', x.handle, 'platform', x.platform,
                                                                     'url', x.clip_url, 'due', x.review_due_at)
                                                  order by x.review_due_at), '[]'::jsonb)
                          from (select * from public.clip_submissions s2
                                 where s2.campaign_id = r.campaign_id::text and s2.status = 'pending' and s2.review_due_at is not null
                                 order by s2.review_due_at limit 10) x));
      insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
      values (r.client_id, 'review_milestone', r.campaign_id, r.to_email, pl) returning id into lid;
      out := out || jsonb_build_object('id', lid, 'kind', 'review_milestone', 'to', r.to_email, 'payload', pl);
    end if;
  end loop;

  -- B. reminder, 6 hours before auto-approval (unchanged rules)
  for r in
    select rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz,
           array_agg(s.id order by s.review_due_at) as ids, count(*) as n, min(s.review_due_at) as first_due,
           jsonb_agg(jsonb_build_object('handle', s.handle, 'platform', s.platform, 'url', s.clip_url,
                                        'due', s.review_due_at) order by s.review_due_at) as clips
      from public.cx_email_recipients() rc
      join public.clip_submissions s
        on s.campaign_id = rc.campaign_id::text and s.status = 'pending'
       and s.review_due_at > now() and s.review_due_at <= now() + interval '6 hours'
     where rc.review_on and rc.rm and rc.to_email is not null and rc.camp_status = 'active'
       and not exists (select 1 from public.client_email_items i
                        where i.client_user_id = rc.client_id and i.submission_id = s.id and i.kind = 'reminder')
     group by rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz
  loop
    pl := jsonb_build_object('campaign_id', r.campaign_id, 'campaign', r.title, 'count', r.n,
                             'first_due', r.first_due, 'timezone', r.tz, 'paused', false, 'clips', r.clips);
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (r.client_id, 'reminder', r.campaign_id, r.to_email, pl) returning id into lid;
    insert into public.client_email_items (client_user_id, submission_id, kind, log_id)
    select r.client_id, unnest(r.ids), 'reminder', lid on conflict do nothing;
    out := out || jsonb_build_object('id', lid, 'kind', 'reminder', 'to', r.to_email, 'payload', pl);
  end loop;

  -- C. weekly report: Monday from 9:00 in the client's timezone, once a week
  for r in
    select rc.* from public.cx_email_recipients() rc
     where rc.wk and rc.to_email is not null
       and extract(isodow from now() at time zone rc.tz) = 1
       and (now() at time zone rc.tz)::time >= time '09:00'
       and not exists (select 1 from public.client_email_log l
                        where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
                          and l.kind = 'weekly_report' and l.status <> 'failed'
                          and l.created_at > now() - interval '6 days')
       and (select count(*) from public.client_email_log l
             where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
               and l.kind = 'weekly_report' and l.status = 'failed' and l.created_at > now() - interval '6 hours') < 3
  loop
    pl := public.cx_weekly_payload(r.campaign_id, r.tz);
    -- a campaign with nothing happening and not running gets no report
    continue when pl is null or (r.camp_status <> 'active' and not (pl->>'active_this_week')::boolean);
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (r.client_id, 'weekly_report', r.campaign_id, r.to_email, pl) returning id into lid;
    out := out || jsonb_build_object('id', lid, 'kind', 'weekly_report', 'to', r.to_email, 'payload', pl);
  end loop;

  -- D. creator events
  for o in select * from public.email_outbox where processed_at is null and attempts < 3 order by id limit 60 loop
    select email into to_addr from auth.users where id = o.recipient_user_id;
    if to_addr is null then
      update public.email_outbox set processed_at = now() where id = o.id;
      continue;
    end if;
    pl := null;
    if o.kind in ('clip_approved','clip_rejected') then
      select sub.*, c.id as camp_uuid, c.title as camp_title into sb
        from public.clip_submissions sub left join public.campaigns c on c.id::text = sub.campaign_id
       where sub.id = o.submission_id;
      -- the decision was reversed before we got to it: stay quiet, and free
      -- the approval key so a later approval of the same clip still emails
      if sb.id is null or (o.kind = 'clip_approved' and sb.status <> 'approved')
                      or (o.kind = 'clip_rejected' and sb.status <> 'rejected') then
        if o.kind = 'clip_approved' then delete from public.email_outbox where id = o.id;
        else update public.email_outbox set processed_at = now() where id = o.id; end if;
        continue;
      end if;
      pl := jsonb_build_object('campaign_id', sb.camp_uuid, 'campaign', coalesce(sb.camp_title, sb.campaign_title),
              'handle', sb.handle, 'platform', sb.platform, 'url', sb.clip_url, 'timezone', 'Asia/Kolkata',
              'decided_at', coalesce(sb.reviewed_at, o.event_at));
      if o.kind = 'clip_rejected' then
        pl := pl || jsonb_build_object(
          'reason', nullif(btrim(regexp_replace(coalesce(sb.rejection_reason, ''),
                                                '^(Rejected by the client|Flagged by the client): ', '')), ''),
          'by_brand', (coalesce(sb.review_source, '') = 'client' or coalesce(sb.rejection_reason, '') ~ '^(Rejected|Flagged) by the client'),
          'deadline', coalesce(sb.reviewed_at, o.event_at) + interval '24 hours');
      end if;
    else
      select ap.*, c.title as camp_title, c.id as camp_uuid, ca.platform as acc_platform,
             coalesce(nullif(ca.handle, ''), ca.username) as acc_handle into a
        from public.campaign_applications ap
        join public.campaigns c on c.id = ap.campaign_id
        left join public.connected_accounts ca on ca.id = ap.connected_account_id
       where ap.id = o.application_id;
      if a.id is null or a.status <> 'approved' then
        delete from public.email_outbox where id = o.id;
        continue;
      end if;
      pl := jsonb_build_object('campaign_id', a.camp_uuid, 'campaign', a.camp_title,
              'handle', case when a.acc_handle is null then null
                             when left(a.acc_handle, 1) = '@' then a.acc_handle else '@' || a.acc_handle end,
              'platform', a.acc_platform, 'timezone', 'Asia/Kolkata');
    end if;
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (o.recipient_user_id, o.kind, (pl->>'campaign_id')::uuid, to_addr, pl) returning id into lid;
    update public.email_outbox set processed_at = now(), attempts = attempts + 1, log_id = lid where id = o.id;
    out := out || jsonb_build_object('id', lid, 'kind', o.kind, 'to', to_addr, 'payload', pl);
  end loop;

  return out;
end $f$;

-- Keep the old name working for the deployed sender until it is redeployed.
create or replace function public.cx_client_email_batch()
returns jsonb language sql security definer set search_path = public as $f$ select public.cx_email_batch() $f$;

create or replace function public.cx_client_email_mark(p_id bigint, p_ok boolean, p_subject text default null,
                                                       p_provider_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $f$
declare l record; recent int;
begin
  select * into l from public.client_email_log where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.client_email_log
       set status = 'sent', sent_at = now(), subject = coalesce(p_subject, subject), provider_id = p_provider_id, error = null
     where id = p_id;
    return;
  end if;
  update public.client_email_log
     set status = 'failed', subject = coalesce(p_subject, subject), error = left(coalesce(p_error, 'unknown error'), 500)
   where id = p_id;
  select count(*) into recent from public.client_email_log
   where client_user_id = l.client_user_id and kind = l.kind and status = 'failed' and created_at > now() - interval '6 hours';
  if recent >= 3 then return; end if;                       -- give up quietly
  if l.kind = 'reminder' then
    delete from public.client_email_items where log_id = p_id;
  elsif l.kind = 'review_milestone' then
    update public.client_review_milestones
       set last_milestone = least(last_milestone, coalesce((l.payload->>'prev_milestone')::int, 0)), updated_at = now()
     where client_user_id = l.client_user_id and campaign_id = l.campaign_id;
  elsif l.kind in ('clip_approved','clip_rejected','private_approved') then
    update public.email_outbox set processed_at = null where log_id = p_id and attempts < 3;
  end if;                                                   -- weekly_report retries by itself
end $f$;

revoke all on function public.cx_email_batch() from public, anon, authenticated;
revoke all on function public.cx_client_email_batch() from public, anon, authenticated;
revoke all on function public.cx_client_email_mark(bigint, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.cx_email_batch() to service_role;
grant execute on function public.cx_client_email_batch() to service_role;
grant execute on function public.cx_client_email_mark(bigint, boolean, text, text, text) to service_role;

-- No seeding of milestones: a client who already has 10 or more clips
-- waiting when this goes live gets one email about them, which is the point.
