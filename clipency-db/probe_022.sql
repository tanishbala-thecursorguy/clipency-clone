do $p$
declare
  cl uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';
  acct uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  camp text := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
  adm uuid := '66f01983-e04e-4e20-80e3-0437698387b8';
  appr uuid; rej uuid; newid uuid; newid2 uuid; r record; out text[] := '{}'; st text; n int;
begin
  select id into appr from clip_submissions where id::text like 'e1f9e9d6%';
  select id into rej from clip_submissions where user_id = cl and status = 'rejected' limit 1;

  -- as the clipper
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  begin
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://instagram.com/reel/DdoydC2tfcZ?igsh=WHATSAPP','pending');
    out := out || 'T1 FAIL dup inserted'::text;
  exception when others then out := out || ('T1 ' || case when sqlstate='23505' then 'ok' else 'FAIL '||sqlstate||' '||sqlerrm end); end;

  begin
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://www.instagram.com/mercyunnfiltered/','pending');
    out := out || 'T2 FAIL profile inserted'::text;
  exception when others then out := out || ('T2 ' || case when sqlstate='22023' then 'ok' else 'FAIL '||sqlstate||' '||sqlerrm end); end;

  begin
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,' https://www.instagram.com/reel/ZZprobe0001/?utm_source=ig_web_copy_link ','pending')
    returning id into newid;
    select clip_key, clip_url into r from clip_submissions where id = newid;
    out := out || ('T3 ' || case when r.clip_key = 'ig:ZZprobe0001' and r.clip_url not like ' %' then 'ok' else 'FAIL '||coalesce(r.clip_key,'null') end);
  exception when others then out := out || ('T3 FAIL '||sqlstate||' '||sqlerrm); end;

  begin
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://instagram.com/reels/ZZprobe0001?igsh=abc','pending');
    out := out || 'T4 FAIL dup of pending inserted'::text;
  exception when others then out := out || ('T4 ' || case when sqlstate='23505' then 'ok' else 'FAIL '||sqlstate||' '||sqlerrm end); end;

  begin
    update clip_submissions set clip_url = 'https://www.instagram.com/reel/SOMEONEELSE1/', campaign_id = 'x', handle = '@x', reviewed_at = null where id = appr;
    select clip_url, campaign_id, handle, reviewed_at into r from clip_submissions where id = appr;
    out := out || ('T5 ' || case when r.clip_url like '%DdoydC2tfcZ%' and r.campaign_id = camp and r.handle = '@mercyunnfiltered' and r.reviewed_at is not null then 'ok' else 'FAIL '||r.clip_url end);
  exception when others then out := out || ('T5 FAIL '||sqlstate||' '||sqlerrm); end;

  begin
    update clip_submissions set appeal_note = 'probe appeal' where id = rej;
    select appeal_note into st from clip_submissions where id = rej;
    out := out || ('T6 ' || case when st = 'probe appeal' then 'ok' else 'FAIL appeal not saved' end);
  exception when others then out := out || ('T6 FAIL '||sqlstate||' '||sqlerrm); end;

  -- as staff: reject the probe row
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform admin_reject_submission(newid, 'probe');

  -- clipper resubmits after rejection
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  begin
    insert into clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
    values (cl,camp,'Vingo','Instagram','@mercyunnfiltered',acct,'https://instagram.com/reel/ZZprobe0001','pending')
    returning id into newid2;
    out := out || 'T7 ok'::text;
  exception when others then out := out || ('T7 FAIL '||sqlstate||' '||sqlerrm); end;

  -- staff re-approves the rejected copy while a live copy exists
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  begin
    perform admin_approve_submission(newid, 0, 0);
    out := out || 'T8 FAIL rejected copy re-approved'::text;
  exception when others then out := out || ('T8 ' || case when sqlstate='23505' then 'ok' else 'FAIL '||sqlstate||' '||sqlerrm end); end;

  -- staff approving the live copy works
  begin
    perform admin_approve_submission(newid2, 0, 0);
    select status into st from clip_submissions where id = newid2;
    out := out || ('T9 ' || case when st = 'approved' then 'ok' else 'FAIL '||coalesce(st,'null') end);
  exception when others then out := out || ('T9 FAIL '||sqlstate||' '||sqlerrm); end;

  -- metrics-style staff update on a grandfathered double approval still works
  begin
    update clip_submissions set likes = likes where id = appr;
    out := out || 'T10 ok'::text;
  exception when others then out := out || ('T10 FAIL '||sqlstate||' '||sqlerrm); end;

  execute 'reset role';
  -- data
  select count(*) into n from (select clip_key from clip_submissions where status <> 'rejected' and clip_key is not null
                                group by clip_key having count(*) > 1) g
   where g.clip_key <> 'ig:ZZprobe0001';
  out := out || ('D1 active dup groups=' || n || case when n = 4 then ' ok' else ' FAIL' end);
  select count(*) into n from clip_submissions p where status = 'pending' and exists
    (select 1 from clip_submissions a where a.clip_key = p.clip_key and a.id <> p.id and a.status in ('approved','flagged'));
  out := out || ('D2 pending dups=' || n || case when n = 0 then ' ok' else ' FAIL' end);
  select count(*) into n from clip_submissions where clip_key is distinct from cx_clip_key(clip_url);
  out := out || ('D3 stale keys=' || n || case when n = 0 then ' ok' else ' FAIL' end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$;
