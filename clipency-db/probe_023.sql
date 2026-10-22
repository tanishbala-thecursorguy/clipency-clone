do $p$
declare
  cl uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';
  acct uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  camp text := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
  vcli uuid := 'a748ff95-7df2-47f0-8895-396747d887d7';
  tcli uuid := 'e3c0138a-4f04-4aa1-9b7f-a3a278f959d2';
  real_pending uuid := '082ad108-350b-4bf9-a633-df2056cf68c5';
  a uuid; b uuid; r record; j jsonb; out text[] := '{}'; st text; n int; pep uuid; upc uuid;
begin
  -- clipper submits, tries to pre-set its own deadline
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status,review_due_at,review_source)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZprobeA001/','pending','2000-01-01','client')
  returning id into a;
  insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/reel/ZZprobeB001/','pending')
  returning id into b;
  select review_due_at, review_source into r from clip_submissions where id = a;
  out := out || ('C1 ' || case when r.review_due_at between now() + interval '47 hours 59 minutes' and now() + interval '48 hours 1 minute'
                                and r.review_source is null then 'ok' else 'FAIL '||coalesce(r.review_due_at::text,'null') end);
  update clip_submissions set review_due_at = '2000-01-01', review_source = 'auto' where id = a;
  select review_due_at, review_source into r from clip_submissions where id = a;
  out := out || ('C2 ' || case when r.review_due_at > now() and r.review_source is null then 'ok' else 'FAIL' end);
  begin
    perform client_review_clip(a, true, null);
    out := out || 'C4 FAIL clipper reviewed'::text;
  exception when others then out := out || ('C4 ' || case when sqlerrm like '%not a client%' then 'ok' else 'FAIL '||sqlerrm end); end;

  -- another brand's client
  perform set_config('request.jwt.claims', json_build_object('sub', tcli, 'role', 'authenticated')::text, true);
  begin
    perform client_review_clip(a, true, null);
    out := out || 'C3 FAIL other client approved'::text;
  exception when others then out := out || ('C3 ' || case when sqlstate = '42501' then 'ok' else 'FAIL '||sqlerrm end); end;
  j := client_dashboard_data();
  select count(*) into n from jsonb_array_elements(j->'pending') e where e->>'campaign_id' = camp;
  out := out || ('C3b ' || case when n = 0 then 'ok' else 'FAIL sees '||n end);

  -- Vingo's client
  perform set_config('request.jwt.claims', json_build_object('sub', vcli, 'role', 'authenticated')::text, true);
  j := client_dashboard_data();
  select count(*) into n from jsonb_array_elements(j->'pending') e where e->>'id' in (a::text, b::text, real_pending::text);
  out := out || ('C10 ' || case when n = 3 then 'ok' else 'FAIL '||n end);
  select count(*) into n from jsonb_array_elements(j->'pending') e
   where e ?| array['earned','earned_native','approved_amount','earning_amount','rate_per_video','views'];
  out := out || ('C10b ' || case when n = 0 then 'ok' else 'FAIL money keys' end);
  select count(*) into n from jsonb_array_elements(j->'pending') e where e->>'campaign_id' <> camp;
  out := out || ('C10c ' || case when n = 0 then 'ok' else 'FAIL foreign pending '||n end);
  begin
    perform client_review_clip(a, false, '   ');
    out := out || 'C5 FAIL empty reason accepted'::text;
  exception when others then out := out || ('C5 ' || case when sqlerrm like '%reason is required%' then 'ok' else 'FAIL '||sqlerrm end); end;
  begin
    j := client_review_clip(a, true, null);
    select status, review_source, reviewed_by, earning_amount_native, earning_status into r from clip_submissions where id = a;
    out := out || ('C6 ' || case when r.status = 'approved' and r.review_source = 'client' and r.reviewed_by = vcli
                                  and r.earning_amount_native > 0 and r.earning_status = 'approved' then 'ok'
                             else 'FAIL '||r.status||' '||coalesce(r.earning_amount_native::text,'null') end);
  exception when others then out := out || ('C6 FAIL '||sqlerrm); end;
  j := client_review_clip(a, true, null);
  out := out || ('C7 ' || case when (j->>'already')::boolean then 'ok' else 'FAIL' end);
  begin
    perform client_review_clip(a, false, 'changed my mind');
    out := out || 'C8 FAIL rejected approved clip'::text;
  exception when others then out := out || ('C8 ' || case when sqlerrm like '%already approved%' then 'ok' else 'FAIL '||sqlerrm end); end;
  begin
    j := client_review_clip(real_pending, false, 'Wrong product shown');
    out := out || ('C9 ' || case when j->>'status' = 'rejected' then 'ok' else 'FAIL '||coalesce(j::text,'null') end);
  exception when others then out := out || ('C9 FAIL '||sqlerrm); end;
  j := client_dashboard_data();
  select count(*) into n from jsonb_array_elements(j->'submissions') e
   where e->>'id' = real_pending::text and e->>'status' = 'rejected'
     and e->'review'->>'source' = 'client' and e->'review'->>'reason' = 'Wrong product shown' and (e->'review'->>'by_me')::boolean;
  out := out || ('C9b ' || case when n = 1 then 'ok' else 'FAIL' end);
  select count(*) into n from jsonb_array_elements(j->'pending') e where e->>'id' in (a::text, real_pending::text);
  out := out || ('C9c ' || case when n = 0 then 'ok' else 'FAIL still pending '||n end);
  select count(*) into n from jsonb_array_elements(j->'submissions') e where e->>'id' = a::text and e->'review'->>'source' = 'client';
  out := out || ('C9d ' || case when n = 1 then 'ok' else 'FAIL' end);

  begin
    perform cx_auto_approve_due();
    out := out || 'C12 FAIL client ran auto-approve'::text;
  exception when others then out := out || ('C12 ' || case when sqlstate = '42501' then 'ok' else 'FAIL '||sqlerrm end); end;
  execute 'reset role';
  execute 'set local role anon';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    perform client_review_clip(b, true, null);
    out := out || 'C13 FAIL anon reviewed'::text;
  exception when others then out := out || ('C13 ' || case when sqlstate = '42501' then 'ok' else 'FAIL '||sqlerrm end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- auto-approve: b overdue on an active campaign; a Peptide (paused) row overdue; Upcraft (no client) untouched
  select status, rejection_reason, review_source into r from clip_submissions where id = real_pending;
  out := out || ('C9e ' || case when r.status = 'rejected' and r.rejection_reason = 'Rejected by the client: Wrong product shown'
                                and r.review_source = 'client' then 'ok' else 'FAIL '||coalesce(r.status,'null') end);
  select id into pep from clip_submissions where campaign_title = 'Peptide Pro' and status = 'pending' limit 1;
  select id into upc from clip_submissions where campaign_title like 'Upcraft%' and status = 'pending' limit 1;
  perform set_config('clipency.trusted_write', '1', true);
  update clip_submissions set review_due_at = now() - interval '1 minute' where id in (b, pep);
  perform set_config('clipency.trusted_write', '0', true);
  j := cx_auto_approve_due();
  select status, review_source, earning_amount_native into r from clip_submissions where id = b;
  out := out || ('C11 ' || case when r.status = 'approved' and r.review_source = 'auto' and r.earning_amount_native > 0 then 'ok' else 'FAIL '||r.status end);
  select status into st from clip_submissions where id = pep;
  out := out || ('C11b paused ' || case when st = 'pending' then 'ok' else 'FAIL '||st end);
  select status, review_due_at into r from clip_submissions where id = upc;
  out := out || ('C11c noclient ' || case when r.status = 'pending' and r.review_due_at is null then 'ok' else 'FAIL' end);
  out := out || ('C11d ' || (j->>'approved') || ' approved, ' || (j->>'skipped') || ' skipped');
  select count(*) into n from cron.job where jobname = 'cx_auto_approve_due' and active and schedule = '*/15 * * * *';
  out := out || ('C14 cron ' || case when n = 1 then 'ok' else 'FAIL' end);
  select count(*) into n from clip_submissions s where s.status = 'pending' and s.review_due_at is null and cx_client_review_on(s.campaign_id);
  out := out || ('C15 unstamped ' || case when n = 0 then 'ok' else 'FAIL '||n end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$;
