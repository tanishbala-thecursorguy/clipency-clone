-- Rolled-back probe for 025 (live email templates). Run: select cx_probe.p025();
-- Everything happens inside one transaction that ends with RAISE, so nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p025() returns void as $p$
declare
  cl uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';    -- a clipper
  acct uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  camp text := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';  -- Vingo
  vA uuid := 'a748ff95-7df2-47f0-8895-396747d887d7';     -- Vingo client A
  vB uuid := '53fd1567-2e29-4dc3-8cda-173820d5236e';     -- Vingo client B
  app1 uuid := '404821b7-5f32-474f-b08a-75c279ac995f';   -- pending application, private Vingo
  app2 uuid := 'e90ce26b-40c5-4ab9-afcb-cd9ab3fc31ac';
  cl_mail text; vB_mail text; app1_mail text;
  j jsonb; e jsonb; n int; m int; k int; out text[] := '{}'; t text; x uuid; y uuid; seq int := 0; lid bigint;
  money_re text := '(rate|payout|earn|fee|pool|amount|cpm|price)';
begin
  delete from client_email_items; delete from email_outbox; delete from client_email_log;
  delete from client_notify_prefs; delete from client_review_milestones;
  select email into cl_mail from auth.users where id = cl;
  select email into vB_mail from auth.users where id = vB;
  select u.email into app1_mail from campaign_applications ap join auth.users u on u.id = ap.user_id where ap.id = app1;
  -- start from an empty review queue, whatever the live one holds (rolled back with the rest)
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set review_due_at = null where campaign_id = camp and status = 'pending';
  perform set_config('clipency.trusted_write', '0', true);
  select count(*) into k from clip_submissions where campaign_id = camp and status = 'pending' and review_due_at is not null;

  -- helper: top the Vingo queue up to a target
  -- (inserted as the clipper's rows; the stamp trigger sets review_due_at)
  while k < 10 loop
    seq := seq + 1;
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZp025x' || lpad(seq::text,3,'0') || '/','pending');
    k := k + 1;
  end loop;

  -- M1 at 10 waiting: one milestone email per Vingo client, clean payload
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i
   where i->>'kind' = 'review_milestone' and i->'payload'->>'campaign_id' = camp
     and (i->'payload'->>'count')::int = 10 and (i->'payload'->>'milestone')::int = 10
     and (i->'payload'->>'prev_milestone')::int = 0 and jsonb_array_length(i->'payload'->'clips') = 10;
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone' and i->'payload'->>'campaign_id' <> camp;
  out := out || ('M1 at 10: both clients, nothing for queues under 10 ' || case when n = 2 and m = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m end);
  select count(*) into n from jsonb_array_elements(j) i
   where i->>'kind' = 'review_milestone' and (
     exists (select 1 from jsonb_object_keys(i->'payload') kk where kk not in
       ('campaign_id','campaign','count','milestone','prev_milestone','first_due','timezone','paused','window_hours','clips'))
     or exists (select 1 from jsonb_array_elements(i->'payload'->'clips') c, jsonb_object_keys(c) kk where kk not in ('handle','platform','url','due')));
  select count(*) into m from jsonb_array_elements(j) i
   where i->>'kind' = 'review_milestone' and i->'payload'->>'campaign_id' = camp
     and i->>'to' not in (select coalesce(p.notify_email, u.email) from auth.users u left join client_notify_prefs p on p.client_user_id = u.id where u.id in (vA, vB));
  out := out || ('M1b payload keys only, Vingo clients only ' || case when n = 0 and m = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- M2 no repeat at the same level
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone';
  out := out || ('M2 no repeat ' || case when n = 0 then 'ok' else 'FAIL ' || n end);

  -- M3 17 sends nothing, 20 sends the second round
  for i in 1..7 loop
    seq := seq + 1;
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZp025x' || lpad(seq::text,3,'0') || '/','pending');
  end loop;
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone';
  for i in 1..3 loop
    seq := seq + 1;
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZp025x' || lpad(seq::text,3,'0') || '/','pending');
  end loop;
  e := cx_email_batch();
  select count(*) into m from jsonb_array_elements(e) i where i->>'kind' = 'review_milestone'
     and (i->'payload'->>'count')::int = 20 and (i->'payload'->>'milestone')::int = 20 and (i->'payload'->>'prev_milestone')::int = 10;
  out := out || ('M3 17 silent, 20 second round ' || case when n = 0 and m = 2 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- M4 the queue drops to 9 (reviews), then climbs to 10 again: a fresh email
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'rejected', reviewed_at = now(), review_source = 'client',
         rejection_reason = 'Rejected by the client: Probe reject'
   where id in (select id from clip_submissions where campaign_id = camp and status = 'pending' and clip_url like '%ZZp025x%'
                order by clip_url limit 11);
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone';
  select count(*) into m from client_review_milestones where campaign_id = camp::uuid and last_milestone = 0;
  select count(*) into k from jsonb_array_elements(j) i where i->>'kind' = 'clip_rejected' and i->>'to' = cl_mail;
  out := out || ('M4 drop to 9: no email, level reset; 11 creator rejections queued ' || case when n = 0 and m = 2 and k = 11 then 'ok' else 'FAIL n=' || n || ' m=' || m || ' k=' || k end);
  seq := seq + 1;
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZp025x' || lpad(seq::text,3,'0') || '/','pending');
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone' and (i->'payload'->>'milestone')::int = 10;
  out := out || ('M4b climb back to 10: emails again ' || case when n = 2 then 'ok' else 'FAIL ' || n end);

  -- M5 client A turns milestone and weekly emails off: only B hears about 20
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  e := client_set_notify_prefs(false, true, null, 'Asia/Kolkata', false);
  out := out || ('M5a prefs saved with weekly off ' || case when (e->>'email_weekly')::boolean = false and (e->>'email_new_clips')::boolean = false then 'ok' else 'FAIL ' || e::text end);
  e := client_get_notify_prefs();
  out := out || ('M5b prefs read back ' || case when (e->>'email_weekly')::boolean = false then 'ok' else 'FAIL ' || e::text end);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  for i in 1..10 loop
    seq := seq + 1;
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZp025x' || lpad(seq::text,3,'0') || '/','pending');
  end loop;
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone';
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone' and i->>'to' = vB_mail;
  select count(*) into k from cx_email_recipients() r where r.client_id = vA and not r.wk and not r.nc;
  out := out || ('M5c only B at 20, A out of weekly ' || case when n = 1 and m = 1 and k >= 1 then 'ok' else 'FAIL n=' || n || ' m=' || m || ' k=' || k end);

  -- M6 a failed milestone send is retried on the next run
  select (i->>'id')::bigint into lid from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone' limit 1;
  perform cx_client_email_mark(lid, false, 's', null, 'Resend 500');
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'review_milestone' and i->>'to' = vB_mail and (i->'payload'->>'milestone')::int = 20;
  out := out || ('M6 retry after failure ' || case when n = 1 then 'ok' else 'FAIL ' || n end);

  -- O1 approval email to the creator, no money
  select id into x from clip_submissions where campaign_id = camp and status = 'pending' and clip_url like '%ZZp025x%' order by clip_url limit 1;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'approved', reviewed_at = now(), review_source = 'client' where id = x;
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'clip_approved' and i->>'to' = cl_mail
     and i->'payload'->>'url' = (select clip_url from clip_submissions where id = x);
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'clip_approved'
     and exists (select 1 from jsonb_object_keys(i->'payload') kk where kk not in ('campaign_id','campaign','handle','platform','url','timezone','decided_at'));
  out := out || ('O1 approved email, exact keys ' || case when n = 1 and m = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- O2 client rejection: reason without the prefix, by the brand, 24h deadline
  select id into y from clip_submissions where campaign_id = camp and status = 'pending' and clip_url like '%ZZp025x%' order by clip_url limit 1;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'rejected', reviewed_at = now(), review_source = 'client',
         rejection_reason = 'Rejected by the client: Wrong pack' where id = y;
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'clip_rejected'
     and i->'payload'->>'reason' = 'Wrong pack' and (i->'payload'->>'by_brand')::boolean
     and (i->'payload'->>'deadline')::timestamptz = (select reviewed_at + interval '24 hours' from clip_submissions where id = y);
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'clip_rejected'
     and exists (select 1 from jsonb_object_keys(i->'payload') kk where kk not in
       ('campaign_id','campaign','handle','platform','url','timezone','decided_at','reason','by_brand','deadline'));
  out := out || ('O2 rejected email: reason, brand, deadline ' || case when n = 1 and m = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- O3 approval reversed before the run: no approval email; a later approval still emails
  select id into x from clip_submissions where campaign_id = camp and status = 'pending' and clip_url like '%ZZp025x%' order by clip_url limit 1;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'approved', reviewed_at = now() where id = x;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'rejected', reviewed_at = now(), rejection_reason = 'Staff: wrong account' where id = x;
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'clip_approved';
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'clip_rejected' and not (i->'payload'->>'by_brand')::boolean
     and i->'payload'->>'reason' = 'Staff: wrong account';
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'approved', reviewed_at = now(), rejection_reason = null where id = x;
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into k from jsonb_array_elements(j) i where i->>'kind' = 'clip_approved' and i->'payload'->>'url' = (select clip_url from clip_submissions where id = x);
  out := out || ('O3 reversal quiet, staff reject, later approval emails ' || case when n = 0 and m = 1 and k = 1 then 'ok' else 'FAIL n=' || n || ' m=' || m || ' k=' || k end);

  -- O4 never two approval emails for the same clip
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'rejected', reviewed_at = now() where id = x;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'approved', reviewed_at = now() where id = x;
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_email_batch();
  select count(*) into n from client_email_log where kind = 'clip_approved' and payload->>'url' = (select clip_url from clip_submissions where id = x);
  out := out || ('O4 one approval email per clip ' || case when n = 1 then 'ok' else 'FAIL ' || n end);

  -- O5 approved into a private campaign; a public campaign sends nothing
  update campaign_applications set status = 'approved' where id = app1;
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'private_approved' and i->>'to' = app1_mail
     and left(i->'payload'->>'handle', 1) = '@' and i->'payload'->>'campaign_id' = camp;
  select count(*) into m from jsonb_array_elements(j) i where i->>'kind' = 'private_approved'
     and exists (select 1 from jsonb_object_keys(i->'payload') kk where kk not in ('campaign_id','campaign','handle','platform','timezone'));
  update campaigns set is_private = false where id = camp::uuid;
  update campaign_applications set status = 'approved' where id = app2;
  select count(*) into k from email_outbox where application_id = app2;
  out := out || ('O5 private approval email, none for public ' || case when n = 1 and m = 0 and k = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m || ' k=' || k end);

  -- O6 a failed creator email is sent again, at most 3 tries
  select id into lid from client_email_log where kind = 'private_approved' limit 1;
  perform cx_client_email_mark(lid, false, 's', null, 'Resend 500');
  j := cx_email_batch();
  select count(*) into n from jsonb_array_elements(j) i where i->>'kind' = 'private_approved';
  select attempts into k from email_outbox where application_id = app1;
  out := out || ('O6 retry ' || case when n = 1 and k = 2 then 'ok' else 'FAIL n=' || n || ' attempts=' || k end);

  -- O7 no creator money in any logged payload
  select count(*) into n from client_email_log l, jsonb_object_keys(l.payload) kk
   where l.kind in ('clip_approved','clip_rejected','private_approved','review_milestone','reminder') and kk ~* money_re;
  select count(*) into m from client_email_log l
   where l.kind in ('clip_approved','clip_rejected','private_approved') and l.payload::text ~* '(budget|spent|currency)';
  out := out || ('O7 no money in creator or review payloads ' || case when n = 0 and m = 0 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- W1 weekly payload: exact keys, Monday to Sunday in the client's zone, no creator money
  e := cx_weekly_payload(camp::uuid, 'Asia/Kolkata');
  select count(*) into n from jsonb_object_keys(e) kk where kk not in
    ('campaign_id','campaign','timezone','week_start','week_end','views','views_prev','views_total','tracking','approved','approved_prev','live','creators',
     'waiting','rejected','auto','currency','spent','budget','top','active_this_week');
  select count(*) into m from jsonb_array_elements(e->'top') tp, jsonb_object_keys(tp) kk where kk not in ('handle','platform','url','views','likes','gain');
  out := out || ('W1 weekly keys ' || case when n = 0 and m = 0 and jsonb_array_length(e->'top') <= 3 then 'ok' else 'FAIL n=' || n || ' m=' || m end);
  out := out || ('W1b week is Mon 00:00 to Sun 23:59:59 IST ' || case when
      extract(isodow from (e->>'week_start')::timestamptz at time zone 'Asia/Kolkata') = 1
      and ((e->>'week_start')::timestamptz at time zone 'Asia/Kolkata')::time = '00:00'
      and (e->>'week_end')::timestamptz - (e->>'week_start')::timestamptz = interval '7 days' - interval '1 second'
      and (e->>'week_end')::timestamptz < now() then 'ok' else 'FAIL ' || (e->>'week_start') || ' ' || (e->>'week_end') end);
  e := cx_weekly_payload(camp::uuid, 'America/New_York');
  out := out || ('W1c other zone ' || case when
      extract(isodow from (e->>'week_start')::timestamptz at time zone 'America/New_York') = 1
      and ((e->>'week_start')::timestamptz at time zone 'America/New_York')::time = '00:00' then 'ok' else 'FAIL' end);
  -- W2 only on Monday from 09:00 in the client's zone
  select count(*) into n from client_email_log where kind = 'weekly_report';
  select count(*) into m from cx_email_recipients() r
   where r.wk and extract(isodow from now() at time zone r.tz) = 1 and (now() at time zone r.tz)::time >= time '09:00';
  out := out || ('W2 weekly only when due ' || case when (m = 0 and n = 0) or (m > 0) then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- G locked down for clients and the public
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vB, 'role', 'authenticated')::text, true);
  begin perform cx_email_batch(); out := out || 'G FAIL client ran batch'::text;
  exception when others then out := out || ('G batch ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform cx_weekly_payload(camp::uuid, 'Asia/Kolkata'); out := out || 'G FAIL client ran weekly payload'::text;
  exception when others then out := out || ('G weekly ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform count(*) from cx_email_recipients(); out := out || 'G FAIL client listed recipients'::text;
  exception when others then out := out || ('G recipients ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform count(*) from email_outbox; out := out || 'G FAIL client read outbox'::text;
  exception when others then out := out || ('G outbox ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform count(*) from client_review_milestones; out := out || 'G FAIL client read milestones'::text;
  exception when others then out := out || ('G milestones ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform cx_email_on_submission(); out := out || 'G FAIL client ran trigger fn'::text;
  exception when others then out := out || ('G trigger fn ' || case when sqlstate in ('42501','0A000') then 'ok' else 'FAIL ' || sqlstate || ' ' || sqlerrm end); end;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform client_set_notify_prefs(true, true, null, null, true); out := out || 'G FAIL anon set prefs'::text;
  exception when others then out := out || ('G anon ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- G2 a review never fails because of email: break the outbox and approve
  select id into x from clip_submissions where campaign_id = camp and status = 'pending' and clip_url like '%ZZp025x%' order by clip_url limit 1;
  alter table email_outbox add constraint cx_probe_block check (false) not valid;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set status = 'approved', reviewed_at = now() where id = x;
  perform set_config('clipency.trusted_write', '0', true);
  select count(*) into n from clip_submissions where id = x and status = 'approved';
  out := out || ('G2 approval survives an email failure ' || case when n = 1 then 'ok' else 'FAIL' end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p025() from public, anon, authenticated;
