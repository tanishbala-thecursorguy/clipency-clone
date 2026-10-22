-- 024 · Email clients when clips are waiting for their review.
--
-- Two emails, both grouped, both opt-out per client from their Profile page:
--   new_clips  "3 new clips are waiting for your review on Vingo"
--              one per client per campaign, at most every 30 minutes, listing
--              every clip not yet emailed about.
--   reminder   "2 clips approve automatically at 7:41 pm unless you act"
--              once per clip, when it is inside 6 hours of auto-approval on an
--              active campaign.
-- Nobody is emailed twice about the same clip for the same kind of email
-- (client_email_items). Every email is logged (client_email_log).
-- Content: creator handle, platform, post link, deadline. Never a rate, a
-- payout, a fee or a pool.
--
-- Sending is done by the edge function client-review-emails (Resend), kicked
-- every 10 minutes by pg_cron. Until an API key exists nothing is queued, so
-- no clip is "used up" before email actually works.

create table if not exists public.client_notify_prefs (
  client_user_id  uuid primary key references auth.users(id) on delete cascade,
  email_new_clips boolean not null default true,
  email_reminders boolean not null default true,
  notify_email    text,
  timezone        text not null default 'Asia/Kolkata',
  updated_at      timestamptz not null default now(),
  constraint client_notify_prefs_email_chk
    check (notify_email is null or (length(notify_email) <= 254 and notify_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
);
alter table public.client_notify_prefs enable row level security;
revoke all on public.client_notify_prefs from anon, authenticated;

create table if not exists public.client_email_log (
  id             bigint generated always as identity primary key,
  client_user_id uuid not null references auth.users(id) on delete cascade,
  kind           text not null check (kind in ('new_clips','reminder','test')),
  campaign_id    uuid,
  to_email       text not null,
  subject        text,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_id    text,
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index if not exists idx_cel_client_kind on public.client_email_log (client_user_id, campaign_id, kind, created_at desc);
alter table public.client_email_log enable row level security;
revoke all on public.client_email_log from anon, authenticated;

create table if not exists public.client_email_items (
  client_user_id uuid not null,
  submission_id  uuid not null,
  kind           text not null,
  log_id         bigint not null references public.client_email_log(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (client_user_id, submission_id, kind)
);
alter table public.client_email_items enable row level security;
revoke all on public.client_email_items from anon, authenticated;

-- ---------- the client's own settings ----------
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
    'notify_email',    p.notify_email,
    'login_email',     login,
    'timezone',        coalesce(p.timezone, 'Asia/Kolkata'),
    'saved',           p.client_user_id is not null);
end $f$;

create or replace function public.client_set_notify_prefs(p_new_clips boolean, p_reminders boolean,
                                                          p_email text default null, p_timezone text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); e text := nullif(lower(btrim(coalesce(p_email, ''))), ''); tz text := nullif(btrim(coalesce(p_timezone, '')), '');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;
  if p_new_clips is null or p_reminders is null then raise exception 'choose on or off for each email'; end if;
  if e is not null and (length(e) > 254 or e !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'enter a valid email address';
  end if;
  if e = (select lower(email) from auth.users where id = uid) then e := null; end if;   -- same as login: follow the login
  if tz is not null and not exists (select 1 from pg_timezone_names where name = tz) then tz := null; end if;
  insert into public.client_notify_prefs as p (client_user_id, email_new_clips, email_reminders, notify_email, timezone, updated_at)
  values (uid, p_new_clips, p_reminders, e, coalesce(tz, 'Asia/Kolkata'), now())
  on conflict (client_user_id) do update
    set email_new_clips = excluded.email_new_clips,
        email_reminders = excluded.email_reminders,
        notify_email    = excluded.notify_email,
        timezone        = coalesce(tz, p.timezone),
        updated_at      = now();
  return public.client_get_notify_prefs();
end $f$;

revoke all on function public.client_get_notify_prefs() from public, anon;
revoke all on function public.client_set_notify_prefs(boolean, boolean, text, text) from public, anon;
grant execute on function public.client_get_notify_prefs() to authenticated;
grant execute on function public.client_set_notify_prefs(boolean, boolean, text, text) to authenticated;

-- ---------- building the batch (service role only) ----------
create or replace function public.cx_client_email_batch()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare r record; lid bigint; out jsonb := '[]'::jsonb;
begin
  -- One sender at a time; a second overlapping run simply does nothing.
  if not pg_try_advisory_xact_lock(hashtext('cx_client_email_batch')) then return out; end if;

  for r in
    with rcpt as (
      select c.id as campaign_id, c.title, c.status as camp_status,
             u.id as client_id, coalesce(p.notify_email, u.email) as to_email,
             coalesce(p.email_new_clips, true) as nc, coalesce(p.email_reminders, true) as rm,
             coalesce(p.timezone, 'Asia/Kolkata') as tz
        from public.campaigns c
        join lateral (select c.client_user_id as uid
                      union
                      select cc.client_user_id from public.campaign_clients cc where cc.campaign_id = c.id) x
          on x.uid is not null
        join auth.users u on u.id = x.uid
        left join public.client_notify_prefs p on p.client_user_id = u.id
       where public.cx_client_review_on(c.id::text)
    ),
    newc as (
      select 'new_clips'::text as kind, rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz,
             array_agg(s.id order by s.created_at) as ids, count(*) as n, min(s.review_due_at) as first_due,
             bool_or(rc.camp_status is distinct from 'active') as paused,
             jsonb_agg(jsonb_build_object('handle', s.handle, 'platform', s.platform, 'url', s.clip_url,
                                          'due', s.review_due_at) order by s.created_at) as clips
        from rcpt rc
        join public.clip_submissions s
          on s.campaign_id = rc.campaign_id::text and s.status = 'pending' and s.review_due_at is not null
       where rc.nc and rc.to_email is not null
         and not exists (select 1 from public.client_email_items i
                          where i.client_user_id = rc.client_id and i.submission_id = s.id and i.kind = 'new_clips')
         and not exists (select 1 from public.client_email_log l
                          where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
                            and l.kind = 'new_clips' and l.status <> 'failed'
                            and l.created_at > now() - interval '30 minutes')
       group by rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz
    ),
    remind as (
      select 'reminder'::text as kind, rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz,
             array_agg(s.id order by s.review_due_at) as ids, count(*) as n, min(s.review_due_at) as first_due,
             false as paused,
             jsonb_agg(jsonb_build_object('handle', s.handle, 'platform', s.platform, 'url', s.clip_url,
                                          'due', s.review_due_at) order by s.review_due_at) as clips
        from rcpt rc
        join public.clip_submissions s
          on s.campaign_id = rc.campaign_id::text and s.status = 'pending'
         and s.review_due_at > now() and s.review_due_at <= now() + interval '6 hours'
       where rc.rm and rc.to_email is not null and rc.camp_status = 'active'
         and not exists (select 1 from public.client_email_items i
                          where i.client_user_id = rc.client_id and i.submission_id = s.id and i.kind = 'reminder')
         -- just told about it: a short review window would otherwise send both at once
         and not exists (select 1 from public.client_email_items i
                          where i.client_user_id = rc.client_id and i.submission_id = s.id and i.kind = 'new_clips'
                            and i.created_at > now() - interval '2 hours')
       group by rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz
    )
    select * from newc union all select * from remind
  loop
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (r.client_id, r.kind, r.campaign_id, r.to_email,
            jsonb_build_object('campaign_id', r.campaign_id, 'campaign', r.title, 'count', r.n,
                               'first_due', r.first_due, 'timezone', r.tz, 'paused', r.paused,
                               'clips', r.clips))
    returning id into lid;
    insert into public.client_email_items (client_user_id, submission_id, kind, log_id)
    select r.client_id, unnest(r.ids), r.kind, lid
    on conflict do nothing;
    out := out || jsonb_build_object('id', lid, 'kind', r.kind, 'to', r.to_email,
                                     'payload', (select payload from public.client_email_log where id = lid));
  end loop;
  return out;
end $f$;

-- The sender reports back. A failure frees the clips for the next run, up to
-- three failures in six hours for that client and kind (then it stops trying).
create or replace function public.cx_client_email_mark(p_id bigint, p_ok boolean, p_subject text default null,
                                                       p_provider_id text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $f$
declare l record; recent int;
begin
  select * into l from public.client_email_log where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update public.client_email_log
       set status = 'sent', sent_at = now(), subject = coalesce(p_subject, subject),
           provider_id = p_provider_id, error = null
     where id = p_id;
  else
    update public.client_email_log
       set status = 'failed', subject = coalesce(p_subject, subject), error = left(coalesce(p_error, 'unknown error'), 500)
     where id = p_id;
    select count(*) into recent from public.client_email_log
     where client_user_id = l.client_user_id and kind = l.kind and status = 'failed'
       and created_at > now() - interval '6 hours';
    if recent < 3 then delete from public.client_email_items where log_id = p_id; end if;
  end if;
end $f$;

-- The Resend key lives in Vault, readable only by the sender.
create or replace function public.cx_email_provider_key()
returns text language sql stable security definer set search_path = public, vault as $f$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key' limit 1
$f$;

revoke all on function public.cx_client_email_batch() from public, anon, authenticated;
revoke all on function public.cx_client_email_mark(bigint, boolean, text, text, text) from public, anon, authenticated;
revoke all on function public.cx_email_provider_key() from public, anon, authenticated;
grant execute on function public.cx_client_email_batch() to service_role;
grant execute on function public.cx_client_email_mark(bigint, boolean, text, text, text) to service_role;
grant execute on function public.cx_email_provider_key() to service_role;

-- ---------- every 10 minutes ----------
create or replace function public.cx_client_email_kick()
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $f$
declare key text; req bigint;
begin
  -- (024b) Always call the sender: the Resend key may be an edge function
  -- secret the database cannot see. The sender does nothing without a key.
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'cx_client_email_kick: service_role_key missing'; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/client-review-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 60000) into req;
  return req;
end $f$;
revoke all on function public.cx_client_email_kick() from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cx_client_review_emails';
  perform cron.schedule('cx_client_review_emails', '*/10 * * * *', 'select public.cx_client_email_kick();');
end $cron$;
