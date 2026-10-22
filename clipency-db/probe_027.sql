-- Rolled-back probe for 027 (admin Creators section: find, connect by username,
-- grant private access, bulk submit into the brand's Review).
-- Run: select cx_probe.p027();  Ends with RAISE: nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p027() returns void as $p$
declare
  cl    uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';   -- a clipper (instagram @mercyunnfiltered)
  igacc uuid := 'b2ef7b85-0328-47eb-949a-3634400b3902';
  vingo uuid := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';   -- private, client review, Youtube+instagram
  tal   uuid := 'af4614c4-d16e-4ee5-8c15-efa1d24a7676';   -- public, client review, all platforms
  talc  uuid := 'e3c0138a-4f04-4aa1-9b7f-a3a278f959d2';   -- Tal's Pod client (owner)
  wot   uuid := 'd4308200-e70c-4465-bde5-e2c217be5b16';   -- paused
  staff uuid := '66f01983-e04e-4e20-80e3-0437698387b8';   -- admin
  other uuid := (select id from public.profiles where role = 'clipper' and id <> 'abbde415-7ab7-48d3-b422-628fc85e8be9' order by created_at limit 1);
  cl_email text := (select email from public.profiles where id = 'abbde415-7ab7-48d3-b422-628fc85e8be9');
  old_url text := (select clip_url from public.clip_submissions where status <> 'rejected' and clip_key like 'yt:%' limit 1);
  yt uuid; tt uuid; z uuid; j jsonb; r jsonb; k int; q0 bigint; q1 bigint; tg_on boolean; t text;
  out text[] := '{}'; ok boolean;
begin
  -- make Telegram look configured so the per-clip ping is really exercised (rolled back, never sent)
  insert into public.telegram_config (key, value) select 'bot_token', 'probe' where not exists (select 1 from public.telegram_config where key = 'bot_token');
  insert into public.telegram_config (key, value) select 'chat_id', '1' where not exists (select 1 from public.telegram_config where key = 'chat_id');
  -- ---------- layer A: access ----------
  ok := true;
  foreach t in array array['anon', cl::text, talc::text] loop
    if t = 'anon' then perform set_config('request.jwt.claims', '', true);
    else perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); end if;
    begin perform public.admin_find_creators('mercy'); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_creator_detail(cl); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_add_connected_account(cl, 'youtube', 'probe027x'); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_grant_campaign_access(igacc, vingo); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_bulk_submit_clips(cl, igacc, tal, array['https://www.instagram.com/reel/ZZp027a/']); ok := false; exception when insufficient_privilege then null; end;
  end loop;
  out := out || ('A1 anon, clipper and client are refused on all 5 ' || case when ok then 'ok' else 'FAIL' end);
  select count(*) into k from information_schema.routine_privileges
   where routine_schema = 'public' and grantee = 'anon' and privilege_type = 'EXECUTE'
     and routine_name in ('admin_find_creators','admin_creator_detail','admin_add_connected_account','admin_grant_campaign_access','admin_bulk_submit_clips','cx_norm_handle');
  out := out || ('A2 no anon execute grant ' || case when k = 0 then 'ok' else 'FAIL ' || k end);

  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);

  -- ---------- layer N: handle parsing ----------
  out := out || ('N1 handle forms ' || case when public.cx_norm_handle('@Foo.Bar') = 'Foo.Bar'
      and public.cx_norm_handle('https://www.instagram.com/foo_bar/?hl=en') = 'foo_bar'
      and public.cx_norm_handle('youtube.com/@Chan-1') = 'Chan-1'
      and public.cx_norm_handle('https://www.tiktok.com/@tok.name?lang=en') = 'tok.name'
      and public.cx_norm_handle(' @spaced ') = 'spaced' then 'ok' else 'FAIL' end);
  out := out || ('N2 junk refused ' || case when public.cx_norm_handle('https://youtube.com/channel/UCabc') is null
      and public.cx_norm_handle('two words') is null and public.cx_norm_handle('') is null
      and public.cx_norm_handle('<script>') is null then 'ok' else 'FAIL' end);

  -- ---------- layer F: find + detail ----------
  j := public.admin_find_creators(cl_email);
  out := out || ('F1 exact email first ' || case when j->0->>'id' = cl::text then 'ok' else 'FAIL' end);
  j := public.admin_find_creators('mercyunnfiltered');
  out := out || ('F2 finds by connected handle ' || case when j @> jsonb_build_array(jsonb_build_object('id', cl)) then 'ok' else 'FAIL' end);
  select count(*) into k from public.profiles p
   where strpos(lower(coalesce(p.email, '')), '__') > 0 or strpos(lower(coalesce(p.username, '')), '__') > 0
      or strpos(lower(coalesce(p.full_name, '')), '__') > 0
      or exists (select 1 from public.connected_accounts a where a.user_id = p.id and strpos(lower(coalesce(a.handle, '')), '__') > 0);
  out := out || ('F3 short query empty, % and _ are literal ' || case when public.admin_find_creators('m') = '[]'::jsonb
      and jsonb_array_length(public.admin_find_creators('%%')) = 0
      and jsonb_array_length(public.admin_find_creators('__')) = least(k, 20) then 'ok' else 'FAIL ' || k end);
  j := public.admin_creator_detail(cl);
  select count(*) into k from public.connected_accounts where user_id = cl;
  out := out || ('F4 detail lists all their accounts ' || case when jsonb_array_length(j->'accounts') = k and j->'profile'->>'email' = cl_email then 'ok' else 'FAIL' end);
  out := out || ('F5 only active campaigns, review flag right ' || case
      when not (j->'campaigns') @> jsonb_build_array(jsonb_build_object('id', wot))
       and (j->'campaigns') @> jsonb_build_array(jsonb_build_object('id', tal, 'client_review', true)) then 'ok' else 'FAIL' end);
  begin perform public.admin_creator_detail(gen_random_uuid()); out := out || 'F6 FAIL unknown creator'::text;
  exception when no_data_found then out := out || 'F6 unknown creator refused ok'::text; end;

  -- ---------- layer C: connect by username ----------
  select count(*) into q0 from net.http_request_queue;
  r := public.admin_add_connected_account(cl, 'YouTube', '@ProbeTube027');
  yt := (r->>'id')::uuid;
  select count(*) into k from public.connected_accounts where id = yt and user_id = cl and platform = 'youtube'
     and handle = 'ProbeTube027' and status = 'verified' and is_verified and verified_by = staff
     and verified_at is not null and profile_url = 'https://www.youtube.com/@ProbeTube027';
  out := out || ('C1 added and verified, no bio code ' || case when r->>'result' = 'added' and k = 1 then 'ok' else 'FAIL ' || r::text end);
  select count(*) into q1 from net.http_request_queue;
  out := out || ('C2 no "new account to verify" ping for it ' || case when q1 = q0 then 'ok' else 'FAIL ' || (q1 - q0) end);
  r := public.admin_add_connected_account(cl, 'youtube', 'https://youtube.com/@probetube027');
  select count(*) into k from public.connected_accounts where user_id = cl and platform = 'youtube' and lower(handle) = 'probetube027';
  out := out || ('C3 same handle again is a no-op ' || case when r->>'result' = 'already' and r->>'id' = yt::text and k = 1 then 'ok' else 'FAIL ' || r::text end);
  begin perform public.admin_add_connected_account(other, 'instagram', 'mercyunnfiltered'); out := out || 'C4 FAIL stole another creator''s handle'::text;
  exception when unique_violation then out := out || 'C4 handle owned by another creator refused ok'::text; end;
  ok := true;
  begin perform public.admin_add_connected_account(cl, 'facebook', 'x1'); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_add_connected_account(cl, 'tiktok', 'two words'); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_add_connected_account(gen_random_uuid(), 'tiktok', 'x1'); ok := false; exception when no_data_found then null; end;
  out := out || ('C5 bad platform, handle or creator refused ' || case when ok then 'ok' else 'FAIL' end);
  insert into public.connected_accounts (user_id, platform, handle, username, status, rejection_reason)
  values (cl, 'tiktok', 'probetok027', 'probetok027', 'rejected', 'code never appeared') returning id into tt;
  r := public.admin_add_connected_account(cl, 'tiktok', '@ProbeTok027');
  select count(*) into k from public.connected_accounts where id = tt and status = 'verified' and is_verified and rejection_reason is null;
  out := out || ('C6 a rejected handle gets verified in place ' || case when r->>'result' = 'verified' and r->>'id' = tt::text and k = 1 then 'ok' else 'FAIL ' || r::text end);

  -- ---------- layer B: bulk submit ----------
  select exists (select 1 from public.telegram_config where key = 'bot_token') and exists (select 1 from public.telegram_config where key = 'chat_id') into tg_on;
  select count(*) into q0 from net.http_request_queue;
  r := public.admin_bulk_submit_clips(cl, yt, tal, array[
    'https://www.youtube.com/shorts/ZZp027yt001',
    'https://www.youtube.com/watch?v=ZZp027yt002',
    'https://youtu.be/ZZp027yt001',
    'https://www.instagram.com/reel/ZZp027ig001/',
    'https://www.youtube.com/@somechannel',
    '   ',
    old_url]);
  select count(*) into q1 from net.http_request_queue;
  out := out || ('B1 2 in, 4 refused, blank skipped ' || case when (r->>'submitted')::int = 2 and (r->>'failed')::int = 4
      and jsonb_array_length(r->'results') = 6 then 'ok' else 'FAIL ' || r::text end);
  out := out || ('B2 each refusal says why ' || case
      when r->'results'->2->>'error' = 'Listed twice in this batch.'
       and r->'results'->3->>'error' = 'That is an Instagram link, but this account is YouTube.'
       and r->'results'->4->>'error' = 'Not a link to a single post.'
       and r->'results'->5->>'error' like 'This clip has already been submitted%' then 'ok' else 'FAIL ' || (r->'results')::text end);
  select count(*) into k from public.clip_submissions s
   where s.id in (select (x->>'id')::uuid from jsonb_array_elements(r->'results') x where (x->>'ok')::boolean)
     and s.user_id = cl and s.connected_account_id = yt and s.status = 'pending' and s.platform = 'YouTube'
     and s.handle = 'ProbeTube027' and s.campaign_id = tal::text and s.campaign_title = (select title from public.campaigns where id = tal)
     and s.review_source is null and s.review_due_at > now() and s.clip_key like 'yt:ZZp027yt00%';
  out := out || ('B3 rows are pending and stamped for the brand''s Review ' || case when k = 2 then 'ok' else 'FAIL ' || k end);
  out := out || ('B4 one Telegram summary, not one per clip ' || case when tg_on and q1 - q0 = 1 then 'ok' else 'FAIL ' || (q1 - q0) end);
  out := out || ('B5 bulk flag cleared afterwards ' || case when coalesce(current_setting('clipency.bulk_submit', true), '') = '' then 'ok' else 'FAIL' end);
  out := out || ('B6 response says client review is on ' || case when (r->>'client_review')::boolean then 'ok' else 'FAIL' end);

  z := (r->'results'->0->>'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', talc, 'role', 'authenticated')::text, true);
  t := public.client_dashboard_data()::text;
  out := out || ('B7 the brand sees the bulk clips ' || case when position(z::text in t) > 0
      and position((r->'results'->1->>'id') in t) > 0 then 'ok' else 'FAIL' end);
  perform public.client_review_clip(z, true, null);
  perform public.client_review_clip((r->'results'->1->>'id')::uuid, false, 'Off brief');
  select count(*) into k from public.clip_submissions where (id = z and status = 'approved' and review_source = 'client')
     or (id = (r->'results'->1->>'id')::uuid and status = 'rejected');
  out := out || ('B8 the brand can approve and reject them ' || case when k = 2 then 'ok' else 'FAIL ' || k end);
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);

  -- private campaign: refused until the account is approved for it
  r := public.admin_bulk_submit_clips(cl, yt, vingo, array['https://www.youtube.com/shorts/ZZp027yt003']);
  out := out || ('B9 private campaign refuses an unapproved account ' || case when (r->>'submitted')::int = 0
      and r->'results'->0->>'error' like 'This is a private campaign%' then 'ok' else 'FAIL ' || r::text end);
  j := public.admin_grant_campaign_access(yt, vingo);
  j := public.admin_grant_campaign_access(yt, vingo);
  select count(*) into k from public.campaign_applications where campaign_id = vingo and connected_account_id = yt and status = 'approved' and user_id = cl;
  out := out || ('G1 grant creates one approved application, twice is safe ' || case when k = 1 then 'ok' else 'FAIL ' || k end);
  update public.campaign_applications set status = 'rejected', rejection_reason = 'x' where campaign_id = vingo and connected_account_id = yt;
  perform public.admin_grant_campaign_access(yt, vingo);
  select count(*) into k from public.campaign_applications where campaign_id = vingo and connected_account_id = yt and status = 'approved' and rejection_reason is null;
  out := out || ('G2 grant overturns a rejection ' || case when k = 1 then 'ok' else 'FAIL' end);
  r := public.admin_bulk_submit_clips(cl, yt, vingo, array['https://www.youtube.com/shorts/ZZp027yt003']);
  out := out || ('B10 after approval the private submit goes through ' || case when (r->>'submitted')::int = 1 then 'ok' else 'FAIL ' || r::text end);

  ok := true;
  begin perform public.admin_bulk_submit_clips(cl, yt, wot, array['https://www.youtube.com/shorts/ZZp027yt004']); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_submit_clips(other, yt, tal, array['https://www.youtube.com/shorts/ZZp027yt004']); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_submit_clips(cl, tt, vingo, array['https://www.tiktok.com/@a/video/1234567890']); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_submit_clips(cl, yt, tal, array[]::text[]); ok := false; exception when invalid_parameter_value then null; end;
  begin perform public.admin_bulk_submit_clips(cl, yt, tal, array_fill('x'::text, array[101])); ok := false; exception when invalid_parameter_value then null; end;
  out := out || ('B11 paused campaign, someone else''s account, wrong platform, empty and >100 refused ' || case when ok then 'ok' else 'FAIL' end);
  update public.connected_accounts set status = 'pending' where id = tt;
  begin perform public.admin_bulk_submit_clips(cl, tt, tal, array['https://www.tiktok.com/@a/video/1234567890']); out := out || 'B12 FAIL unverified account accepted'::text;
  exception when invalid_parameter_value then out := out || 'B12 unverified account refused ok'::text; end;
  begin perform public.admin_grant_campaign_access(tt, vingo); out := out || 'G3 FAIL unverified account granted'::text;
  exception when invalid_parameter_value then out := out || 'G3 unverified account cannot be granted ok'::text; end;

  r := public.admin_bulk_submit_clips(cl, yt, tal, array['https://youtube.com/shorts/ZZp027yt002?feature=share']);
  out := out || ('B13 a clip the brand rejected can be resubmitted ' || case when (r->>'submitted')::int = 1 then 'ok' else 'FAIL ' || r::text end);
  r := public.admin_bulk_submit_clips(cl, yt, tal, array['https://youtube.com/shorts/ZZp027yt001']);
  out := out || ('B14 a live clip cannot be submitted twice ' || case when (r->>'submitted')::int = 0 then 'ok' else 'FAIL' end);

  select count(*) into q0 from net.http_request_queue;
  insert into public.clip_submissions (user_id, campaign_id, campaign_title, platform, handle, connected_account_id, clip_url, status)
  values (cl, tal::text, 'Tal', 'YouTube', 'ProbeTube027', yt, 'https://www.youtube.com/shorts/ZZp027yt009', 'pending');
  select count(*) into q1 from net.http_request_queue;
  out := out || ('B15 a normal submission still pings Telegram ' || case when tg_on and q1 - q0 = 1 then 'ok' else 'FAIL ' || (q1 - q0) end);

  j := public.admin_creator_detail(cl);
  out := out || ('D1 detail shows new accounts, clips and application ' || case
      when (j->'accounts') @> jsonb_build_array(jsonb_build_object('id', yt, 'by_admin', true, 'status', 'verified'))
       and (j->'clips') @> jsonb_build_array(jsonb_build_object('id', z, 'status', 'approved'))
       and (j->'applications') @> jsonb_build_array(jsonb_build_object('campaign_id', vingo, 'account_id', yt, 'status', 'approved'))
      then 'ok' else 'FAIL' end);
  perform set_config('request.jwt.claims', '', true);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p027() from public, anon, authenticated;
