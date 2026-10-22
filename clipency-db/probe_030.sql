-- Rolled-back probe for 030 (fewer emails). Run: select cx_probe.p030();
-- Clients: one daily summary. Creators: rejections at once, approvals in batches of 5.
-- Uses the test clock clipency.email_now to step through time. Ends with RAISE: nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p030() returns void as $p$
declare
  vingo uuid := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
  cl    uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';   -- a clipper
  acct  uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  ztz text := 'Asia/Kolkata';
  d date := (now() at time zone 'Asia/Kolkata')::date;
  p uuid[] := '{}'; v uuid; i int; me text;
  b jsonb; k int; exp_dig int; out text[] := '{}'; lid bigint; n1 int; e jsonb;
begin
  select email into me from auth.users where id = cl;
  if me is null then raise exception 'PROBE needs the probe clipper to have an email'; end if;

  -- expected digests: every Vingo recipient not already sent one today
  select count(*) into exp_dig from public.cx_email_recipients() rc
   where rc.campaign_id = vingo and rc.review_on and (rc.nc or rc.rm) and rc.to_email is not null and rc.camp_status = 'active'
     and exists (select 1 from public.clip_submissions s where s.campaign_id = vingo::text and s.status = 'pending' and s.review_due_at is not null)
     and not exists (select 1 from public.client_email_log l where l.client_user_id = rc.client_id and l.campaign_id = vingo
                      and l.kind = 'review_digest' and l.status <> 'failed' and (l.created_at at time zone ztz)::date = d);

  -- ---------- clients ----------
  perform set_config('clipency.email_now', ((d + time '09:30') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T1 before 10:00 no client summary ' || case when not exists (select 1 from jsonb_array_elements(b) x where x->>'kind' = 'review_digest') then 'ok' else 'FAIL' end);

  perform set_config('clipency.email_now', ((d + time '10:30') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  select count(*) into k from jsonb_array_elements(b) x where x->>'kind' = 'review_digest' and x->'payload'->>'campaign_id' = vingo::text;
  select count(*) into n1 from public.clip_submissions where campaign_id = vingo::text and status = 'pending' and review_due_at is not null;
  out := out || ('T2 one summary per Vingo recipient ' || case when k = exp_dig then 'ok' else 'FAIL ' || k || '/' || exp_dig end);
  out := out || ('T3 summary counts every clip waiting, lists the 5 soonest ' || case when k = 0 or not exists (
      select 1 from jsonb_array_elements(b) x where x->>'kind' = 'review_digest' and x->'payload'->>'campaign_id' = vingo::text
        and ((x->'payload'->>'count')::int <> n1 or jsonb_array_length(x->'payload'->'clips') > 5
             or (x->'payload'->>'digest')::boolean is not true)) then 'ok' else 'FAIL' end);
  perform set_config('clipency.email_now', ((d + time '15:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T4 never a second summary the same day ' || case when not exists (select 1 from jsonb_array_elements(b) x where x->>'kind' = 'review_digest') then 'ok' else 'FAIL' end);
  out := out || ('T5 no per-batch reminders or every-10 emails any more ' || case when not exists (
      select 1 from public.client_email_log where kind in ('reminder', 'review_milestone') and created_at >= now()) then 'ok' else 'FAIL' end);

  -- ---------- creators ----------
  -- 20 probe clips for one creator on Vingo, all waiting
  for i in 1 .. 20 loop
    perform set_config('clipency.trusted_write', '1', true);
    insert into public.clip_submissions (user_id, campaign_id, campaign_title, platform, handle, connected_account_id, clip_url, status)
    values (cl, vingo::text, 'Vingo', 'Instagram', '@probe', acct, 'https://www.instagram.com/reel/ZZp030b' || i || '/', 'pending')
    returning id into v;
    p := p || v;
  end loop;
  -- approve 1-4, approve 5 then take it back, reject 8 (each write sets the flag: settling resets it)
  for i in 1 .. 5 loop
    perform set_config('clipency.trusted_write', '1', true);
    update public.clip_submissions set status = 'approved', reviewed_at = now() + i * interval '1 second' where id = p[i];
  end loop;
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'pending' where id = p[5];
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'rejected', reviewed_at = now(), rejection_reason = 'Probe' where id = p[8];
  perform set_config('clipency.trusted_write', '0', true);

  -- 03:00 tomorrow: the rejection goes, nothing else for this creator
  perform set_config('clipency.email_now', ((d + 1 + time '03:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T6 a rejection goes straight away, even at night ' || case when exists (select 1 from jsonb_array_elements(b) x
      where x->>'kind' = 'clip_rejected' and x->>'to' = me and x->'payload'->>'url' like '%ZZp030b8/') then 'ok' else 'FAIL' end);
  out := out || ('T7 no approval email at night ' || case when not exists (select 1 from jsonb_array_elements(b) x
      where x->>'kind' in ('clip_approved', 'clips_approved')) then 'ok' else 'FAIL' end);

  -- 12:00 tomorrow: 5 queued but one was taken back, so 4: it waits
  perform set_config('clipency.email_now', ((d + 1 + time '12:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T8 4 approvals wait for a fifth ' || case when not exists (select 1 from jsonb_array_elements(b) x
      where x->>'kind' in ('clip_approved', 'clips_approved') and x->>'to' = me) then 'ok' else 'FAIL' end);
  out := out || ('T9 the approval taken back is dropped and its key freed ' || case when exists (select 1 from public.email_outbox
      where submission_id = p[5] and kind = 'clip_approved' and processed_at is not null and dedupe_key like '%:dropped:%')
      and (select count(*) from public.email_outbox where submission_id = any(p[1:4]) and kind = 'clip_approved' and processed_at is null) = 4
      then 'ok' else 'FAIL' end);

  -- the fifth approval: one email with all 5, latest first
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now() + interval '6 seconds' where id = p[6];
  perform set_config('clipency.trusted_write', '0', true);
  perform set_config('clipency.email_now', ((d + 1 + time '13:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  select x.value into e from jsonb_array_elements(b) x where x->>'to' = me and x->>'kind' in ('clip_approved', 'clips_approved');
  out := out || ('T10 5 approvals: one email, all 5 listed, latest first, one campaign named ' || case when
      (select count(*) from jsonb_array_elements(b) x where x->>'to' = me and x->>'kind' in ('clip_approved', 'clips_approved')) = 1
      and e->>'kind' = 'clips_approved' and (e->'payload'->>'count')::int = 5 and jsonb_array_length(e->'payload'->'clips') = 5
      and e->'payload'->'clips'->0->>'url' like '%ZZp030b6/' and e->'payload'->>'campaign' is not null
      then 'ok' else 'FAIL ' || coalesce(e::text, 'none') end);

  -- approving 5 again and 7: queued again, but 2 is not a batch
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now() where id = p[5];
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now() where id = p[7];
  perform set_config('clipency.trusted_write', '0', true);
  out := out || ('T11 approving it again queues it again ' || case when exists (select 1 from public.email_outbox
      where submission_id = p[5] and kind = 'clip_approved' and processed_at is null) then 'ok' else 'FAIL' end);
  perform set_config('clipency.email_now', ((d + 1 + time '14:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T12 2 approvals wait ' || case when not exists (select 1 from jsonb_array_elements(b) x
      where x->>'to' = me and x->>'kind' in ('clip_approved', 'clips_approved')) then 'ok' else 'FAIL' end);

  -- a week on: the 2 that never reached 5 go out anyway
  perform set_config('clipency.email_now', ((d + 8 + time '12:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T13 under 5 still goes out after 7 days ' || case when exists (select 1 from jsonb_array_elements(b) x
      where x->>'to' = me and x->>'kind' = 'clips_approved' and (x->'payload'->>'count')::int = 2) then 'ok' else 'FAIL' end);

  -- 12 approvals at once: one email, counts 12, lists the 10 latest
  for i in 9 .. 20 loop
    perform set_config('clipency.trusted_write', '1', true);
    update public.clip_submissions set status = 'approved', reviewed_at = now() + i * interval '1 minute' where id = p[i];
  end loop;
  perform set_config('clipency.trusted_write', '0', true);
  perform set_config('clipency.email_now', ((d + 8 + time '13:00') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  select x.value into e from jsonb_array_elements(b) x where x->>'to' = me and x->>'kind' = 'clips_approved';
  out := out || ('T14 12 approvals: count 12, the 10 latest listed ' || case when (e->'payload'->>'count')::int = 12
      and jsonb_array_length(e->'payload'->'clips') = 10 and e->'payload'->'clips'->0->>'url' like '%ZZp030b20/'
      and not exists (select 1 from jsonb_array_elements(e->'payload'->'clips') c where c->>'url' like '%ZZp030b9/' or c->>'url' like '%ZZp030b10/')
      then 'ok' else 'FAIL ' || coalesce(e::text, 'none') end);

  -- a failed email puts all 12 back for the next run
  lid := (e->>'id')::bigint;
  perform public.cx_client_email_mark(lid, false, null, null, 'probe failure');
  select count(*) into k from public.email_outbox where log_id = lid and processed_at is null;
  out := out || ('T15 a failed batch is retried whole ' || case when k = 12 then 'ok' else 'FAIL ' || k end);
  perform set_config('clipency.email_now', ((d + 8 + time '21:30') at time zone ztz)::text, true);
  b := public.cx_email_batch();
  out := out || ('T16 no approval email after 21:00 ' || case when not exists (select 1 from jsonb_array_elements(b) x
      where x->>'kind' in ('clip_approved', 'clips_approved')) then 'ok' else 'FAIL' end);

  out := out || ('T17 sender runs hourly ' || case when (select schedule from cron.job where jobid = 9) = '5 * * * *' then 'ok' else 'FAIL' end);
  perform set_config('clipency.email_now', '', true);
  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p030() from public, anon, authenticated;
