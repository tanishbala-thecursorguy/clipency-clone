-- Rolled-back probe for 024 (client review emails). SUPERSEDED by probe_025.sql: 025 replaced the
-- per-submission "new_clips" email with the every-10 milestone, so E1 to E4 here no longer apply.
-- Run: select cx_probe.p024();
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p024() returns void as $p$
declare
  cl uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';
  acct uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  camp text := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
  vA uuid := 'a748ff95-7df2-47f0-8895-396747d887d7';   -- Vingo owner
  vB uuid := '53fd1567-2e29-4dc3-8cda-173820d5236e';   -- Vingo + Peptide
  tA uuid := 'e3c0138a-4f04-4aa1-9b7f-a3a278f959d2';   -- Tal's Pod only
  s1 uuid; s2 uuid; s3 uuid; s4 uuid; j jsonb; e jsonb; n int; m int; out text[] := '{}'; t text; pending_v int;
begin
  -- clean slate for this transaction
  delete from client_email_items; delete from client_email_log; delete from client_notify_prefs;

  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZmail0001/','pending') returning id into s1;
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZmail0002/','pending') returning id into s2;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into pending_v from clip_submissions where campaign_id = camp and status = 'pending';

  -- E1 first batch: one email per client per campaign, all pending clips, no money
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->>'kind' = 'new_clips' and x->'payload'->>'campaign_id' = camp;
  select count(*) into m from jsonb_array_elements(j) x where x->>'kind' = 'new_clips' and x->'payload'->>'campaign_id' = camp
     and (x->'payload'->>'count')::int = pending_v and jsonb_array_length(x->'payload'->'clips') = pending_v;
  out := out || ('E1 ' || case when n = 2 and m = 2 then 'ok' else 'FAIL n=' || n || ' m=' || m || ' pending=' || pending_v end);
  select count(*) into n from jsonb_array_elements(j) x, jsonb_array_elements(x->'payload'->'clips') c
   where exists (select 1 from jsonb_object_keys(c) k where k not in ('handle','platform','url','due'));
  select count(*) into m from jsonb_array_elements(j) x
   where exists (select 1 from jsonb_object_keys(x->'payload') k
                  where k not in ('campaign_id','campaign','count','first_due','timezone','paused','clips'));
  out := out || ('E1b no-money payload ' || case when n = 0 and m = 0 then 'ok' else 'FAIL' end);
  select count(*) into n from jsonb_array_elements(j) x
   where x->'payload'->>'campaign_id' = camp and x->>'to' not in (select email from auth.users where id in (vA, vB));
  out := out || ('E1c recipients are Vingo clients ' || case when n = 0 then 'ok' else 'FAIL' end);
  select count(*) into n from jsonb_array_elements(j) x
   where x->'payload'->>'campaign_id' = camp and x->>'to' = (select email from auth.users where id = tA);
  select count(*) into m from jsonb_array_elements(j) x
   where x->'payload'->>'campaign' like 'Tal%' and x->>'to' = (select email from auth.users where id = tA);
  n := n + case when m = 1 then 0 else 100 end;
  out := out || ('E1d Tal client gets no Vingo mail ' || case when n = 0 then 'ok' else 'FAIL' end);

  -- E2 immediately again: nothing new for Vingo
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->'payload'->>'campaign_id' = camp;
  out := out || ('E2 no repeat ' || case when n = 0 then 'ok' else 'FAIL ' || n end);

  -- E3 a new clip inside 30 minutes waits; after 30 minutes it goes alone
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZmail0003/','pending') returning id into s3;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->'payload'->>'campaign_id' = camp;
  update client_email_log set created_at = now() - interval '31 minutes';
  update client_email_items set created_at = now() - interval '31 minutes';
  e := cx_client_email_batch();
  select count(*) into m from jsonb_array_elements(e) x
   where x->'payload'->>'campaign_id' = camp and (x->'payload'->>'count')::int = 1
     and x->'payload'->'clips'->0->>'url' like '%ZZmail0003%';
  out := out || ('E3 throttle then single ' || case when n = 0 and m = 2 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- E4 client A turns new-clip emails off and redirects nothing; B still gets them
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  e := client_set_notify_prefs(false, true, null, 'Asia/Kolkata');
  perform set_config('request.jwt.claims', json_build_object('sub', vB, 'role', 'authenticated')::text, true);
  e := client_set_notify_prefs(true, true, 'Brand.Team@Example.com', 'America/New_York');
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZmail0004/','pending') returning id into s4;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  update client_email_log set created_at = now() - interval '31 minutes';
  update client_email_items set created_at = now() - interval '3 hours';
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->>'kind' = 'new_clips' and x->'payload'->>'campaign_id' = camp;
  select count(*) into m from jsonb_array_elements(j) x where x->>'kind' = 'new_clips' and x->'payload'->>'campaign_id' = camp
     and x->>'to' = 'brand.team@example.com' and x->'payload'->>'timezone' = 'America/New_York';
  out := out || ('E4 prefs: A off, B to override address ' || case when n = 1 and m = 1 then 'ok' else 'FAIL n=' || n || ' m=' || m end);

  -- E5 reminder: s1 due in 3 hours; both clients (A still wants reminders), once only
  perform set_config('clipency.trusted_write', '1', true);
  -- one statement: an AFTER trigger (settlement) resets trusted_write after each update
  update clip_submissions set review_due_at = now() + interval '3 hours' where id in (s1, s4);
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->>'kind' = 'reminder' and x->'payload'->>'campaign_id' = camp;
  select count(*) into m from jsonb_array_elements(j) x, jsonb_array_elements(x->'payload'->'clips') c
   where x->>'kind' = 'reminder' and c->>'url' like '%ZZmail0004%'
     and x->>'to' = (select email from auth.users where id = vA);
  select count(*) into t from jsonb_array_elements(j) x, jsonb_array_elements(x->'payload'->'clips') c
   where x->>'kind' = 'reminder' and c->>'url' like '%ZZmail0004%';
  out := out || ('E5 reminder to both; the just-announced clip only to the client who got no announcement ' ||
                 case when n = 2 and m = 1 and t = '1' then 'ok' else 'FAIL n=' || n || ' m=' || m || ' t=' || t end);
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x where x->>'kind' = 'reminder' and x->'payload'->'clips' @> '[{"url":"https://www.instagram.com/reel/ZZmail0001/"}]';
  out := out || ('E5b reminder once ' || case when n = 0 then 'ok' else 'FAIL ' || n end);

  -- E6 paused campaign: no reminder even inside 6 hours
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set review_due_at = now() + interval '2 hours'
   where campaign_title = 'Peptide Pro' and status = 'pending';
  perform set_config('clipency.trusted_write', '0', true);
  update client_email_items set created_at = now() - interval '3 hours';
  j := cx_client_email_batch();
  select count(*) into n from jsonb_array_elements(j) x
   where x->>'kind' = 'reminder' and x->'payload'->>'campaign' = 'Peptide Pro';
  out := out || ('E6 paused: no reminder ' || case when n = 0 then 'ok' else 'FAIL ' || n end);

  -- E7 a failed send frees its clips for the next run
  select id into n from client_email_log where kind = 'reminder' and to_email = 'brand.team@example.com' limit 1;
  perform cx_client_email_mark(n, false, 'subj', null, 'Resend 500');
  j := cx_client_email_batch();
  select count(*) into m from jsonb_array_elements(j) x where x->>'kind' = 'reminder' and x->>'to' = 'brand.team@example.com';
  out := out || ('E7 retry after failure ' || case when m = 1 then 'ok' else 'FAIL ' || m end);
  select (x->>'id') into t from jsonb_array_elements(j) x where x->>'kind' = 'reminder' and x->>'to' = 'brand.team@example.com';
  perform cx_client_email_mark(t::bigint, true, 'subj', 're_123', null);
  select count(*) into m from client_email_log where id = t::bigint and status = 'sent' and provider_id = 're_123' and sent_at is not null;
  out := out || ('E7b mark sent ' || case when m = 1 then 'ok' else 'FAIL' end);

  -- E8 settings RPC validation
  select email into t from auth.users where id = vA;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  begin
    e := client_set_notify_prefs(true, true, 'not-an-email', null);
    out := out || 'E8 FAIL bad email accepted'::text;
  exception when others then out := out || ('E8 ' || case when sqlerrm like '%valid email%' then 'ok' else 'FAIL ' || sqlerrm end); end;
  e := client_set_notify_prefs(true, false, upper(t), 'Mars/Olympus');
  out := out || ('E8b same-as-login + bad tz ' || case when e->>'notify_email' is null and e->>'timezone' = 'Asia/Kolkata'
                                                        and (e->>'email_reminders')::boolean = false then 'ok' else 'FAIL ' || e::text end);

  -- E9 locked down
  begin perform cx_client_email_batch(); out := out || 'E9 FAIL client ran batch'::text;
  exception when others then out := out || ('E9 batch ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform cx_client_email_mark(1, true, null, null, null); out := out || 'E9 FAIL client ran mark'::text;
  exception when others then out := out || ('E9 mark ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform cx_email_provider_key(); out := out || 'E9 FAIL client read key'::text;
  exception when others then out := out || ('E9 key ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform count(*) from client_email_log; out := out || 'E9 FAIL client read log'::text;
  exception when others then out := out || ('E9 log ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform count(*) from client_notify_prefs; out := out || 'E9 FAIL client read prefs table'::text;
  exception when others then out := out || ('E9 prefs table ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  begin perform client_get_notify_prefs(); out := out || 'E9 FAIL clipper read prefs'::text;
  exception when others then out := out || ('E9 clipper ' || case when sqlerrm like '%not a client%' then 'ok' else 'FAIL ' || sqlerrm end); end;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin perform client_set_notify_prefs(true, true, null, null); out := out || 'E9 FAIL anon set prefs'::text;
  exception when others then out := out || ('E9 anon ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- E10 the job exists and does nothing without a provider key
  select count(*) into n from cron.job where jobname = 'cx_client_review_emails' and active and schedule = '*/10 * * * *';
  out := out || ('E10 cron ' || case when n = 1 and cx_client_email_kick() is null then 'ok' else 'FAIL' end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p024() from public, anon, authenticated;
