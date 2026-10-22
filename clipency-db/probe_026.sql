-- Rolled-back probe for 026 (per-platform rates, $0 campaigns, no flags after approval,
-- client emails per campaign). Run: select cx_probe.p026();  Ends with RAISE: nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p026() returns void as $p$
declare
  cl    uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';   -- a clipper
  acct  uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  vingo uuid := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';   -- per video, INR
  jst   uuid := (select id from public.campaigns where title like 'JSTJR%' limit 1);  -- per view, USD
  tal   uuid := 'af4614c4-d16e-4ee5-8c15-efa1d24a7676';
  vA    uuid := 'a748ff95-7df2-47f0-8895-396747d887d7';   -- Vingo client (owner)
  staff uuid := '66f01983-e04e-4e20-80e3-0437698387b8';
  c public.campaigns%rowtype; s public.clip_submissions%rowtype;
  yt uuid; ig uuid; pv uuid; z uuid; zc uuid; j jsonb; e jsonb; n numeric; m numeric; k int;
  spent0 numeric; earn0 numeric; out text[] := '{}'; t text;
begin
  -- start from no platform rows; live rows are cleared inside this rolled-back run only
  perform public.cx_platform_rates_prune(x.campaign_id, array[]::text[])
     from (select distinct campaign_id from public.campaign_platform_rates) x;
  select sum(coalesce(earning_amount_native, 0)) into earn0 from public.clip_submissions;
  select * into c from public.campaigns where id = vingo;
  spent0 := public.cx_campaign_client_spent(c);

  -- ---------- layer 1: resolution ----------
  out := out || ('R1 platform names ' || case when public.cx_platform_key('Instagram') = 'instagram'
      and public.cx_platform_key('YouTube Shorts') = 'youtube' and public.cx_platform_key('Youtube') = 'youtube'
      and public.cx_platform_key('TikTok') = 'tiktok' and public.cx_platform_key(' ') is null then 'ok' else 'FAIL' end);
  select count(*) into k from public.cx_platform_rate(vingo, 'YouTube') x
   where not x.custom and x.rate_per_video = c.rate_per_video and x.client_rate_per_video = public.campaign_client_unit_rate(c);
  out := out || ('R2 no row: campaign rates ' || case when k = 1 then 'ok' else 'FAIL' end);

  insert into public.campaign_platform_rates (campaign_id, platform, rate_per_video, client_rate_per_video)
  values (vingo, 'youtube', 0, 0);
  select count(*) into k from public.cx_platform_rate(vingo, 'YouTube Shorts') x
   where x.custom and x.rate_per_video = 0 and x.client_rate_per_video = 0;
  out := out || ('R3 YouTube row resolves to 0 ' || case when k = 1 then 'ok' else 'FAIL' end);
  begin
    insert into public.campaign_platform_rates (campaign_id, platform, rate_per_video, client_rate_per_video)
    values (vingo, 'tiktok', 300, 100);
    out := out || 'R4 FAIL brand below creator accepted'::text;
  exception when check_violation then out := out || 'R4 brand below creator refused ok'::text; end;

  -- baseline after the YouTube row exists, so live YouTube clips already on the
  -- campaign do not move the number this check is about
  spent0 := public.cx_campaign_client_spent(c);

  -- ---------- layer 2: per-video settlement and brand spend (Vingo) ----------
  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl, vingo::text, 'Vingo', 'YouTube', '@mercyunnfiltered', acct, 'https://www.youtube.com/shorts/ZZp026yt001', 'pending') returning id into yt;
  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl, vingo::text, 'Vingo', 'Instagram', '@mercyunnfiltered', acct, 'https://www.instagram.com/reel/ZZp026ig001/', 'pending') returning id into ig;
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now() where id in (yt, ig);
  perform set_config('clipency.trusted_write', '0', true);
  select * into s from public.clip_submissions where id = yt;
  out := out || ('S1 YouTube clip frozen at 0, earns 0 ' || case when s.rate_per_video_at_approval = 0
      and coalesce(s.earning_amount_native, 0) = 0 then 'ok' else 'FAIL rate=' || coalesce(s.rate_per_video_at_approval::text,'null') || ' earn=' || coalesce(s.earning_amount_native::text,'null') end);
  select * into s from public.clip_submissions where id = ig;
  out := out || ('S2 Instagram clip keeps the campaign rate ' || case when s.rate_per_video_at_approval = c.rate_per_video
      then 'ok' else 'FAIL rate=' || coalesce(s.rate_per_video_at_approval::text,'null') end);
  select * into c from public.campaigns where id = vingo;
  n := public.cx_campaign_client_spent(c) - spent0;
  out := out || ('S3 brand billed 0 for YouTube, the unit for Instagram ' || case when n = public.campaign_client_unit_rate(c)
      then 'ok' else 'FAIL delta=' || n || ' unit=' || public.campaign_client_unit_rate(c) end);

  -- a later rate change never moves an approved clip
  update public.campaign_platform_rates set rate_per_video = 999 where campaign_id = vingo and platform = 'youtube';
  perform public.cx_settle_creator_campaign(cl, vingo::text);
  select * into s from public.clip_submissions where id = yt;
  out := out || ('S4 raising the YouTube rate later leaves the approved clip at 0 ' || case when s.rate_per_video_at_approval = 0
      and coalesce(s.earning_amount_native, 0) = 0 then 'ok' else 'FAIL earn=' || coalesce(s.earning_amount_native::text,'null') end);
  update public.campaign_platform_rates set rate_per_video = 0 where campaign_id = vingo and platform = 'youtube';

  -- nothing else anyone earned moved
  select sum(coalesce(earning_amount_native, 0)) into n from public.clip_submissions where id not in (yt, ig);
  out := out || ('S5 every other earning unchanged ' || case when n = earn0 then 'ok' else 'FAIL ' || n || ' vs ' || earn0 end);

  -- ---------- layer 3: per-view (JSTJR): YouTube creator 0, brand per-view price ----------
  insert into public.campaign_platform_rates (campaign_id, platform, rpm, client_rpm) values (jst, 'youtube', 0, 1000);
  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl, jst::text, 'JSTJR', 'YouTube', '@mercyunnfiltered', acct, 'https://www.youtube.com/shorts/ZZp026yt002', 'pending') returning id into pv;
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now(), views_count = 200000, metrics_status = 'ok' where id = pv;
  perform set_config('clipency.trusted_write', '0', true);
  select * into s from public.clip_submissions where id = pv;
  select * into c from public.campaigns where id = jst;
  out := out || ('V1 per-view YouTube creator earns 0 ' || case when s.rate_per_million_at_approval = 0
      and coalesce(s.earning_amount_native, 0) = 0 then 'ok' else 'FAIL rpm=' || coalesce(s.rate_per_million_at_approval::text,'null') || ' earn=' || coalesce(s.earning_amount_native::text,'null') end);
  out := out || ('V2 brand pays its own per-view price (200K x 1000/1M = 200) ' || case when public.cx_clip_client_cost(c, s) = 200
      then 'ok' else 'FAIL ' || public.cx_clip_client_cost(c, s) end);

  -- ---------- layer 4: $0 campaign ----------
  insert into public.campaigns (title, status, payout_model, rate_per_video, budget, currency, platform, created_by)
  values ('ZZ probe zero', 'active', 'per_video', 0, 0, 'USD', 'YouTube', staff) returning id into z;
  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl, z::text, 'ZZ probe zero', 'YouTube', '@mercyunnfiltered', acct, 'https://www.youtube.com/shorts/ZZp026yt003', 'pending') returning id into zc;
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions set status = 'approved', reviewed_at = now() where id = zc;
  perform set_config('clipency.trusted_write', '0', true);
  select * into s from public.clip_submissions where id = zc;
  select * into c from public.campaigns where id = z;
  out := out || ('Z1 $0 campaign: approved, earns 0, brand billed 0, still tracked ' || case when s.status = 'approved'
      and coalesce(s.earning_amount_native, 0) = 0 and public.cx_campaign_client_spent(c) = 0
      and public.clip_metrics_eligible(zc) and not c.client_emails then 'ok' else 'FAIL' end);

  -- currency switch converts platform rows too
  insert into public.campaign_platform_rates (campaign_id, platform, rate_per_video, client_rate_per_video) values (z, 'instagram', 10, 12);
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated',
                     'email', (select u.email from auth.users u where u.id = staff))::text, true);
  j := public.admin_convert_campaign_currency(z, 'INR');
  perform set_config('request.jwt.claims', '', true);
  select count(*) into k from public.campaign_platform_rates pr, public.campaigns cc
   where pr.campaign_id = z and cc.id = z and pr.platform = 'instagram'
     and pr.rate_per_video = round(10 * cc.fx_rate_per_usd, 2) and pr.client_rate_per_video = round(12 * cc.fx_rate_per_usd, 2);
  out := out || ('Z2 currency switch converts platform rates ' || case when k = 1 then 'ok' else 'FAIL' end);

  -- ---------- layer 5: who can see what ----------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  begin perform count(*) from public.campaign_platform_rates; out := out || 'G1 FAIL client read the rates table'::text;
  exception when others then out := out || ('G1 client cannot read rates table ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform * from public.cx_platform_rate(vingo, 'youtube'); out := out || 'G2 FAIL client resolved rates'::text;
  exception when others then out := out || ('G2 client cannot resolve rates ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform public.admin_set_platform_rates(vingo, '[]'::jsonb); out := out || 'G3 FAIL client set rates'::text;
  exception when others then out := out || ('G3 client cannot set rates ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  begin perform public.admin_platform_rates(); out := out || 'G4 FAIL client listed rates'::text;
  exception when others then out := out || ('G4 client cannot list rates ' || case when sqlstate = '42501' then 'ok' else 'FAIL ' || sqlerrm end); end;
  out := out || ('G5 client gets no creator rates ' || case when public.cx_campaign_creator_rates(vingo) is null then 'ok' else 'FAIL' end);
  e := public.client_dashboard_data();
  select count(*) into k from jsonb_array_elements(e->'submissions') x where x->>'id' = yt::text and (x->>'earned_native')::numeric = 0;
  out := out || ('G6 client dashboard bills the YouTube clip at 0 ' || case when k = 1 then 'ok' else 'FAIL' end);
  out := out || ('G7 no rate table in the client payload ' || case when e::text !~* 'platform_rate|client_rpm' then 'ok' else 'FAIL' end);

  -- ---------- layer 6: no flags after approval ----------
  begin perform public.client_flag_clip(ig, 'Wrong product'); out := out || 'F1 FAIL approved clip flagged'::text;
  exception when others then out := out || ('F1 approved clip refused ' || case when sqlerrm like '%can no longer be flagged%' then 'ok' else 'FAIL ' || sqlerrm end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  -- an old approved clip (before this change) is refused too
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  begin
    perform public.client_flag_clip((select s3.id from public.clip_submissions s3 where s3.campaign_id = vingo::text
                                      and s3.status = 'approved' order by s3.created_at limit 1), 'Old one');
    out := out || 'F2 FAIL old approved clip flagged'::text;
  exception when others then out := out || ('F2 older approved clips refused too ' || case when sqlerrm like '%can no longer be flagged%' then 'ok' else 'FAIL ' || sqlerrm end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,connected_account_id,clip_url,status)
  values (cl, vingo::text, 'Vingo', 'Instagram', '@mercyunnfiltered', acct, 'https://www.instagram.com/reel/ZZp026pend1/', 'pending') returning id into pv;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', vA, 'role', 'authenticated')::text, true);
  j := public.client_flag_clip(pv, 'Wrong product');
  out := out || ('F3 a pending clip can still be flagged ' || case when j->>'status' = 'flagged' then 'ok' else 'FAIL ' || j::text end);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- ---------- layer 7: client emails per campaign; creator emails everywhere ----------
  select string_agg(distinct r.title, ',') into t from public.cx_email_recipients() r;
  out := out || ('E1 only Vingo clients are emailed ' || case when t like 'Vingo%' and t not like '%,%' then 'ok' else 'FAIL ' || coalesce(t, 'none') end);
  update public.campaigns set client_emails = true where id = tal;
  select count(distinct r.campaign_id) into k from public.cx_email_recipients() r where r.campaign_id = tal;
  out := out || ('E2 switching a campaign on adds its clients ' || case when k = 1 then 'ok' else 'FAIL' end);
  update public.campaigns set client_emails = false where id = tal;
  -- approvals go out in batches of 5, or after 7 days for fewer (030): run the sender 8 days on, at noon IST
  perform set_config('clipency.email_now', (((now() at time zone 'Asia/Kolkata')::date + 8 + time '12:00') at time zone 'Asia/Kolkata')::text, true);
  j := public.cx_email_batch();
  perform set_config('clipency.email_now', '', true);
  select count(*) into k from jsonb_array_elements(j) x where x->>'kind' in ('clip_approved', 'clips_approved')
     and x->>'to' = (select u.email from auth.users u where u.id = cl)
     and (x->'payload'->>'campaign_id' = jst::text or exists (select 1 from jsonb_array_elements(coalesce(x->'payload'->'clips', '[]'::jsonb)) ci
                                                             where ci->>'campaign_id' = jst::text and ci->>'url' like '%ZZp026yt002%'));
  out := out || ('E3 creators still get approval emails on a campaign with client emails off ' || case when k = 1 then 'ok' else 'FAIL ' || k end);
  select count(*) into k from jsonb_array_elements(j) x where x->>'kind' in ('review_digest','review_milestone','reminder','weekly_report')
     and x->'payload'->>'campaign_id' <> vingo::text;
  out := out || ('E4 no client email for any other campaign ' || case when k = 0 then 'ok' else 'FAIL ' || k end);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p026() from public, anon, authenticated;
