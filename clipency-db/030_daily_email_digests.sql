-- 030_daily_email_digests.sql
-- Fewer emails. Was: a client email at every 10 clips waiting plus a reminder
-- for every batch about to auto-approve (~13 a day per client), and one email
-- per approved clip to creators (up to 12 a day each).
-- Now:
--   clients:  one "N clips are waiting" summary a day per campaign, from 10:00
--             in the client's timezone, only when something is waiting and the
--             campaign is active. Weekly report unchanged.
--   creators: approvals go out in batches: one "N clips approved" email once
--             5 are waiting (10 latest listed), or after 7 days for fewer, between
--             10:00 and 21:00 IST. Rejections (24-hour redo clock) and
--             private-campaign access still go out straight away.
--   cron:     the sender runs hourly instead of every 10 minutes.
-- Test clock: set clipency.email_now to a timestamptz to simulate the time of day.

-- The email log accepts the two new kinds.
alter table public.client_email_log drop constraint if exists client_email_log_kind_check,
  add constraint client_email_log_kind_check check (kind = any (array['new_clips','review_milestone','review_digest','reminder',
    'weekly_report','clip_approved','clips_approved','clip_rejected','private_approved','test']));

create or replace function public.cx_email_batch()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare r record; lid bigint; out jsonb := '[]'::jsonb; pl jsonb; o record; sb record; a record; to_addr text;
        v_now timestamptz := coalesce(nullif(current_setting('clipency.email_now', true), '')::timestamptz, now());
        ist text := 'Asia/Kolkata'; v_clips jsonb; v_n int; v_ids bigint[];
begin
  if not pg_try_advisory_xact_lock(hashtext('cx_client_email_batch')) then return out; end if;

  -- A. clients: one daily summary per campaign while clips are waiting
  for r in
    select rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz,
           count(s.id)::int as n, min(s.review_due_at) as first_due
      from public.cx_email_recipients() rc
      join public.clip_submissions s
        on s.campaign_id = rc.campaign_id::text and s.status = 'pending' and s.review_due_at is not null
     where rc.review_on and (rc.nc or rc.rm) and rc.to_email is not null and rc.camp_status = 'active'
       and (v_now at time zone rc.tz)::time >= time '10:00'
       and not exists (select 1 from public.client_email_log l
                        where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
                          and l.kind = 'review_digest' and l.status <> 'failed'
                          and (l.created_at at time zone rc.tz)::date = (v_now at time zone rc.tz)::date)
       and (select count(*) from public.client_email_log l
             where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
               and l.kind = 'review_digest' and l.status = 'failed' and l.created_at > v_now - interval '6 hours') < 3
     group by rc.campaign_id, rc.title, rc.client_id, rc.to_email, rc.tz
  loop
    pl := jsonb_build_object('campaign_id', r.campaign_id, 'campaign', r.title, 'count', r.n, 'digest', true,
            'first_due', r.first_due, 'timezone', r.tz, 'paused', false,
            'window_hours', (select client_review_hours from public.campaigns where id = r.campaign_id),
            'clips', (select coalesce(jsonb_agg(jsonb_build_object('handle', x.handle, 'platform', x.platform,
                                                                   'url', x.clip_url, 'due', x.review_due_at)
                                                order by x.review_due_at), '[]'::jsonb)
                        from (select * from public.clip_submissions s2
                               where s2.campaign_id = r.campaign_id::text and s2.status = 'pending' and s2.review_due_at is not null
                               order by s2.review_due_at limit 5) x));
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (r.client_id, 'review_digest', r.campaign_id, r.to_email, pl) returning id into lid;
    out := out || jsonb_build_object('id', lid, 'kind', 'review_digest', 'to', r.to_email, 'payload', pl);
  end loop;

  -- C. weekly report: Monday from 9:00 in the client's timezone, once a week (unchanged)
  for r in
    select rc.* from public.cx_email_recipients() rc
     where rc.wk and rc.to_email is not null
       and extract(isodow from v_now at time zone rc.tz) = 1
       and (v_now at time zone rc.tz)::time >= time '09:00'
       and not exists (select 1 from public.client_email_log l
                        where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
                          and l.kind = 'weekly_report' and l.status <> 'failed'
                          and l.created_at > v_now - interval '6 days')
       and (select count(*) from public.client_email_log l
             where l.client_user_id = rc.client_id and l.campaign_id = rc.campaign_id
               and l.kind = 'weekly_report' and l.status = 'failed' and l.created_at > v_now - interval '6 hours') < 3
  loop
    pl := public.cx_weekly_payload(r.campaign_id, r.tz);
    continue when pl is null or (r.camp_status <> 'active' and not (pl->>'active_this_week')::boolean);
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (r.client_id, 'weekly_report', r.campaign_id, r.to_email, pl) returning id into lid;
    out := out || jsonb_build_object('id', lid, 'kind', 'weekly_report', 'to', r.to_email, 'payload', pl);
  end loop;

  -- D1. creators: approvals in batches of 5. One email once 5 approvals are
  --     waiting: it counts them all and lists the 10 latest. Fewer than 5 go out
  --     once the oldest has waited 7 days. Daytime only, 10:00 to 21:00 IST.
  if (v_now at time zone ist)::time between time '10:00' and time '21:00' then
    for r in
      select q.recipient_user_id as uid, array_agg(q.id order by q.id) as ids
        from public.email_outbox q
       where q.kind = 'clip_approved' and q.processed_at is null and q.attempts < 3
       group by q.recipient_user_id
      having count(*) >= 5 or min(q.event_at) < v_now - interval '7 days'
       limit 100
    loop
      select email into to_addr from auth.users where id = r.uid;
      if to_addr is null then
        update public.email_outbox set processed_at = now() where id = any(r.ids);
        continue;
      end if;
      -- an approval reversed before the email went out: drop it and free its dedupe key
      update public.email_outbox ob
         set processed_at = now(), dedupe_key = ob.dedupe_key || ':dropped:' || ob.id
       where ob.id = any(r.ids)
         and not exists (select 1 from public.clip_submissions s where s.id = ob.submission_id and s.status = 'approved');
      select array_agg(ob.id order by ob.id) into v_ids from public.email_outbox ob where ob.id = any(r.ids) and ob.processed_at is null;
      continue when v_ids is null;
      -- still a batch after the drops? otherwise wait for more
      continue when cardinality(v_ids) < 5
                and (select min(ob.event_at) from public.email_outbox ob where ob.id = any(v_ids)) >= v_now - interval '7 days';
      select count(*)::int into v_n from public.email_outbox ob join public.clip_submissions s on s.id = ob.submission_id
       where ob.id = any(v_ids);
      select coalesce(jsonb_agg(x.j order by x.t desc), '[]'::jsonb) into v_clips
        from (select jsonb_build_object('campaign_id', c.id, 'campaign', coalesce(c.title, s.campaign_title),
                       'handle', s.handle, 'platform', s.platform, 'url', s.clip_url,
                       'decided_at', coalesce(s.reviewed_at, ob.event_at)) as j,
                     coalesce(s.reviewed_at, ob.event_at) as t
                from public.email_outbox ob
                join public.clip_submissions s on s.id = ob.submission_id
                left join public.campaigns c on c.id::text = s.campaign_id
               where ob.id = any(v_ids)
               order by t desc limit 10) x;
      if v_n = 0 then
        update public.email_outbox set processed_at = now() where id = any(v_ids);
        continue;
      elsif v_n = 1 then
        pl := (v_clips->0) || jsonb_build_object('timezone', ist);
      else
        pl := jsonb_build_object('count', v_n, 'clips', v_clips, 'timezone', ist,
                'campaign_id', v_clips->0->>'campaign_id',
                'campaign', case when (select count(distinct s.campaign_id) from public.email_outbox ob
                                        join public.clip_submissions s on s.id = ob.submission_id where ob.id = any(v_ids)) = 1
                                 then v_clips->0->>'campaign' end);
      end if;
      insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
      values (r.uid, case when v_n = 1 then 'clip_approved' else 'clips_approved' end,
              nullif(pl->>'campaign_id', '')::uuid, to_addr, pl) returning id into lid;
      update public.email_outbox set processed_at = now(), attempts = attempts + 1, log_id = lid where id = any(v_ids);
      out := out || jsonb_build_object('id', lid, 'kind', case when v_n = 1 then 'clip_approved' else 'clips_approved' end,
                                       'to', to_addr, 'payload', pl);
    end loop;
  end if;

  -- D2. creators: rejections and private-campaign approvals, straight away
  for o in select * from public.email_outbox
            where processed_at is null and attempts < 3 and kind <> 'clip_approved' order by id limit 60 loop
    select email into to_addr from auth.users where id = o.recipient_user_id;
    if to_addr is null then
      update public.email_outbox set processed_at = now() where id = o.id;
      continue;
    end if;
    pl := null;
    if o.kind = 'clip_rejected' then
      select sub.*, c.id as camp_uuid, c.title as camp_title into sb
        from public.clip_submissions sub left join public.campaigns c on c.id::text = sub.campaign_id
       where sub.id = o.submission_id;
      if sb.id is null or sb.status <> 'rejected' then
        update public.email_outbox set processed_at = now() where id = o.id;
        continue;
      end if;
      pl := jsonb_build_object('campaign_id', sb.camp_uuid, 'campaign', coalesce(sb.camp_title, sb.campaign_title),
              'handle', sb.handle, 'platform', sb.platform, 'url', sb.clip_url, 'timezone', ist,
              'decided_at', coalesce(sb.reviewed_at, o.event_at),
              'reason', nullif(btrim(regexp_replace(coalesce(sb.rejection_reason, ''),
                                                    '^(Rejected by the client|Flagged by the client): ', '')), ''),
              'by_brand', (coalesce(sb.review_source, '') = 'client' or coalesce(sb.rejection_reason, '') ~ '^(Rejected|Flagged) by the client'),
              'deadline', coalesce(sb.reviewed_at, o.event_at) + interval '24 hours');
    else
      select ap.*, c.title as camp_title, c.id as camp_uuid, ca.platform as acc_platform,
             coalesce(nullif(ca.handle, ''), ca.username) as acc_handle into a
        from public.campaign_applications ap
        join public.campaigns c on c.id = ap.campaign_id
        left join public.connected_accounts ca on ca.id = ap.connected_account_id
       where ap.id = o.application_id;
      if a.id is null or a.status <> 'approved' then
        update public.email_outbox set processed_at = now(), dedupe_key = dedupe_key || ':dropped:' || id where id = o.id;
        continue;
      end if;
      pl := jsonb_build_object('campaign_id', a.camp_uuid, 'campaign', a.camp_title,
              'handle', case when a.acc_handle is null then null
                             when left(a.acc_handle, 1) = '@' then a.acc_handle else '@' || a.acc_handle end,
              'platform', a.acc_platform, 'timezone', ist);
    end if;
    insert into public.client_email_log (client_user_id, kind, campaign_id, to_email, payload)
    values (o.recipient_user_id, o.kind, (pl->>'campaign_id')::uuid, to_addr, pl) returning id into lid;
    update public.email_outbox set processed_at = now(), attempts = attempts + 1, log_id = lid where id = o.id;
    out := out || jsonb_build_object('id', lid, 'kind', o.kind, 'to', to_addr, 'payload', pl);
  end loop;

  return out;
end $function$;

-- A failed approval summary puts its approvals back in the queue, like a single one did.
do $do$
declare d text := pg_get_functiondef('public.cx_client_email_mark(bigint,boolean,text,text,text)'::regprocedure);
begin
  if position('''clips_approved''' in d) = 0 then
    d := replace(d, $a$elsif l.kind in ('clip_approved','clip_rejected','private_approved') then$a$,
                    $b$elsif l.kind in ('clip_approved','clips_approved','clip_rejected','private_approved') then$b$);
    if position('''clips_approved''' in d) = 0 then raise exception 'cx_client_email_mark anchor not found'; end if;
    execute d;
  end if;
end $do$;

-- The sender runs hourly, at 5 past.
select cron.alter_job(job_id := 9, schedule := '5 * * * *');
