-- Rolled-back probe for 029 (Creators browse: KPIs, all / by campaign / new
-- sign-ups lists, profile campaigns, connect straight into a campaign).
-- Run: select cx_probe.p029();  Ends with RAISE: nothing is kept.
create schema if not exists cx_probe;
revoke all on schema cx_probe from public, anon, authenticated;
create or replace function cx_probe.p029() returns void as $p$
declare
  cl    uuid := 'abbde415-7ab7-48d3-b422-628fc85e8be9';
  vingo uuid := 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';   -- private, Youtube+instagram
  tal   uuid := 'af4614c4-d16e-4ee5-8c15-efa1d24a7676';   -- public
  talc  uuid := 'e3c0138a-4f04-4aa1-9b7f-a3a278f959d2';
  staff uuid := '66f01983-e04e-4e20-80e3-0437698387b8';
  nu uuid; nu2 uuid;
  ids text[]; o jsonb; l jsonb; l2 jsonb; l3 jsonb; r jsonb; t text; k int; k2 int; ok boolean; out text[] := '{}';
begin
  select id into nu from public.profiles p where role = 'clipper'
     and not exists (select 1 from public.clip_submissions s where s.user_id = p.id)
     and not exists (select 1 from public.campaign_applications a where a.user_id = p.id)
     and not exists (select 1 from public.connected_accounts a where a.user_id = p.id)
   order by created_at desc limit 1;
  select id into nu2 from public.profiles p where role = 'clipper' and id <> nu
     and not exists (select 1 from public.clip_submissions s where s.user_id = p.id)
     and not exists (select 1 from public.campaign_applications a where a.user_id = p.id)
   order by created_at desc limit 1;

  -- ---------- A: access ----------
  ok := true;
  foreach t in array array['anon', cl::text, talc::text] loop
    if t = 'anon' then perform set_config('request.jwt.claims', '', true);
    else perform set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true); end if;
    begin perform public.admin_creators_overview(); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_list_creators(); ok := false; exception when insufficient_privilege then null; end;
    begin perform public.admin_connect_account(nu, 'youtube', 'p029x', null, true); ok := false; exception when insufficient_privilege then null; end;
  end loop;
  out := out || ('A1 anon, clipper and client refused ' || case when ok then 'ok' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub', staff, 'role', 'authenticated')::text, true);

  -- ---------- O: KPIs match the tables ----------
  o := public.admin_creators_overview();
  select count(*) into k from public.profiles where role = 'clipper';
  out := out || ('O1 creators ' || case when (o->>'creators')::int = k then 'ok' else 'FAIL ' || o->>'creators' || '/' || k end);
  select count(*) into k from public.profiles p where role = 'clipper'
     and not exists (select 1 from public.clip_submissions s where s.user_id = p.id)
     and not exists (select 1 from public.campaign_applications a where a.user_id = p.id);
  out := out || ('O2 never joined ' || case when (o->>'never_joined')::int = k then 'ok' else 'FAIL' end);
  select count(*) into k from public.profiles where role = 'clipper' and created_at > now() - interval '7 days';
  out := out || ('O3 new this week ' || case when (o->>'new_7d')::int = k then 'ok' else 'FAIL' end);
  select count(*) into k from public.connected_accounts a join public.profiles p on p.id = a.user_id and p.role = 'clipper'
   where a.status = 'verified' and a.platform = 'youtube';
  out := out || ('O4 verified YouTube accounts ' || case when (o->'platforms'->>'youtube')::int = k then 'ok' else 'FAIL' end);

  -- ---------- L: all creators ----------
  l := public.admin_list_creators('all', null, null, null, 'all', 'all', null, 'newest', 10, 0);
  l2 := public.admin_list_creators('all', null, null, null, 'all', 'all', null, 'newest', 5, 0);
  l3 := public.admin_list_creators('all', null, null, null, 'all', 'all', null, 'newest', 5, 5);
  out := out || ('L1 total is every creator, pages line up ' || case when (l->>'total')::int = (o->>'creators')::int
      and (select jsonb_agg(x->'id') from jsonb_array_elements(l->'rows') x)
        = (select jsonb_agg(x->'id') from (select x from jsonb_array_elements(l2->'rows') x union all select x from jsonb_array_elements(l3->'rows') x) y)
      then 'ok' else 'FAIL' end);
  l := public.admin_list_creators('all', null, null, null, 'all', 'all', null, 'clips', 30, 0);
  select count(*) into k from (select (x->>'clips')::int c, lag((x->>'clips')::int) over (order by ord) prev
     from jsonb_array_elements(l->'rows') with ordinality e(x, ord)) z where z.prev < z.c;
  out := out || ('L2 most clips sorts down ' || case when k = 0 and jsonb_array_length(l->'rows') = 30 then 'ok' else 'FAIL ' || k end);
  l := public.admin_list_creators('all', null, null, 'YouTube', 'all', 'all', null, 'newest', 200, 0);
  select count(distinct a.user_id) into k from public.connected_accounts a join public.profiles p on p.id = a.user_id and p.role = 'clipper'
   where a.status = 'verified' and a.platform = 'youtube';
  out := out || ('L3 platform filter ' || case when (l->>'total')::int = k
      and not exists (select 1 from jsonb_array_elements(l->'rows') x where (x->>'yt')::int = 0) then 'ok' else 'FAIL' end);
  l := public.admin_list_creators('all', null, null, null, 'never_joined', 'all', null, 'newest', 5, 0);
  l2 := public.admin_list_creators('all', null, null, null, 'no_accounts', 'all', null, 'newest', 200, 0);
  out := out || ('L4 segments ' || case when (l->>'total')::int = (o->>'never_joined')::int
      and not exists (select 1 from jsonb_array_elements(l2->'rows') x where (x->>'verified')::int > 0) then 'ok' else 'FAIL' end);
  l := public.admin_list_creators('all', null, 'mercyunnfiltered');
  out := out || ('L5 text filter finds by handle ' || case when l->'rows' @> jsonb_build_array(jsonb_build_object('id', cl)) then 'ok' else 'FAIL' end);
  -- no creator twice: page through everyone
  k := 0; ids := '{}';
  loop
    l := public.admin_list_creators('all', null, null, null, 'all', 'all', null, 'clips', 200, k);
    exit when jsonb_array_length(l->'rows') = 0;
    ids := ids || array(select x->>'id' from jsonb_array_elements(l->'rows') x);
    k := k + 200;
  end loop;
  select count(*), count(distinct u) into k, k2 from unnest(ids) u;
  out := out || ('L7 paging through everyone: each creator exactly once ' || case when k = k2 and k = (o->>'creators')::int then 'ok' else 'FAIL ' || k || '/' || k2 end);
  l := public.admin_list_creators('all', null, '%%');
  out := out || ('L6 wildcards are literal ' || case when (l->>'total')::int = 0 then 'ok' else 'FAIL' end);

  -- ---------- C: by campaign ----------
  l := public.admin_list_creators('campaign', vingo, null, null, 'all', 'all', null, 'clips', 200, 0);
  select count(*) into k from public.profiles p where p.role = 'clipper' and (
      exists (select 1 from public.clip_submissions s where s.user_id = p.id and s.campaign_id = vingo::text)
      or exists (select 1 from public.campaign_applications a where a.user_id = p.id and a.campaign_id = vingo));
  select count(*) into k2 from public.clip_submissions s join public.profiles p on p.id = s.user_id and p.role = 'clipper'
   where s.campaign_id = vingo::text;
  out := out || ('C1 everyone in the campaign, clip totals right ' || case when (l->>'total')::int = k
      and (l->'campaign'->>'clips')::int = k2 and (l->'campaign'->>'is_private')::boolean then 'ok' else 'FAIL ' || (l->>'total') || '/' || k end);
  select count(*) into k from public.clip_submissions where user_id = cl and campaign_id = vingo::text and connected_account_id = 'b2ef7b85-0328-47eb-949a-3634400b3902';
  out := out || ('C2 a creator''s accounts in that campaign, with access ' || case
      when (select x->'campaign_accounts' from jsonb_array_elements(l->'rows') x where x->>'id' = cl::text)
           @> jsonb_build_array(jsonb_build_object('handle', 'mercyunnfiltered', 'access', 'approved', 'clips', k)) then 'ok' else 'FAIL' end);
  select count(*) into k from jsonb_array_elements(l->'rows') x, jsonb_array_elements(x->'campaign_accounts') y
   where y->>'account_id' is not null
   group by x->>'id', y->>'account_id' having count(*) > 1;
  out := out || ('C5 no account listed twice for a creator ' || case when coalesce(k, 0) = 0 then 'ok' else 'FAIL' end);
  k := 0;
  select coalesce(sum((x->>'clips')::int), 0) into k from jsonb_array_elements(l->'rows') x;
  select coalesce(sum((y->>'clips')::int), 0) into k2 from jsonb_array_elements(l->'rows') x, jsonb_array_elements(x->'campaign_accounts') y;
  out := out || ('C6 per-account clips add up to the creator total, nothing double counted ' || case when k = k2 then 'ok' else 'FAIL ' || k || '/' || k2 end);
  l := public.admin_list_creators('campaign', vingo, null, null, 'all', 'pending');
  select count(distinct user_id) into k from public.campaign_applications a join public.profiles p on p.id = a.user_id and p.role = 'clipper'
   where a.campaign_id = vingo and a.status = 'pending';
  out := out || ('C3 waiting-for-access filter ' || case when (l->>'total')::int = k then 'ok' else 'FAIL ' || (l->>'total') || '/' || k end);
  begin perform public.admin_list_creators('campaign', null); out := out || 'C4 FAIL no campaign accepted'::text;
  exception when invalid_parameter_value then out := out || 'C4 campaign view needs a campaign ok'::text; end;

  -- ---------- N: new sign-ups ----------
  l := public.admin_list_creators('new', null, null, null, 'all', 'all', null, 'newest', 200, 0);
  l2 := public.admin_list_creators('new', null, null, null, 'all', 'all', 7, 'newest', 200, 0);
  select count(*) into k from public.profiles p where role = 'clipper' and created_at > now() - interval '7 days'
     and not exists (select 1 from public.clip_submissions s where s.user_id = p.id)
     and not exists (select 1 from public.campaign_applications a where a.user_id = p.id);
  out := out || ('N1 feed is never-joined creators, newest first ' || case when (l->>'total')::int = (o->>'never_joined')::int
      and (l2->>'total')::int = k
      and not exists (select 1 from jsonb_array_elements(l->'rows') x where (x->>'clips')::int > 0)
      and (l->'rows'->0->>'created_at')::timestamptz >= (l->'rows'->1->>'created_at')::timestamptz then 'ok' else 'FAIL' end);
  out := out || ('N2 a brand new creator is in it ' || case when l->'rows' @> jsonb_build_array(jsonb_build_object('id', nu)) then 'ok' else 'FAIL' end);

  -- ---------- K: connect straight into a campaign ----------
  r := public.admin_connect_account(nu, 'YouTube', '@probe029yt', vingo, true);
  select count(*) into k from public.campaign_applications a join public.connected_accounts c on c.id = a.connected_account_id
   where a.campaign_id = vingo and a.user_id = nu and a.status = 'approved' and c.status = 'verified' and c.handle = 'probe029yt';
  out := out || ('K1 private + bypass: verified and approved, no review ' || case when r->>'access' = 'approved' and k = 1 then 'ok' else 'FAIL ' || r::text end);
  l := public.admin_list_creators('new', null, null, null, 'all', 'all', null, 'newest', 200, 0);
  l2 := public.admin_list_creators('campaign', vingo, '@probe029yt');
  out := out || ('K2 they leave New sign-ups and show in the campaign ' || case
      when not (l->'rows' @> jsonb_build_array(jsonb_build_object('id', nu)))
       and l2->'rows' @> jsonb_build_array(jsonb_build_object('id', nu)) then 'ok' else 'FAIL' end);
  r := public.admin_connect_account(nu, 'instagram', 'probe029ig', vingo, false);
  select count(*) into k from public.campaign_applications where campaign_id = vingo and connected_account_id = (r->>'id')::uuid and status = 'pending';
  l := public.admin_list_creators('campaign', vingo, null, null, 'all', 'pending', null, 'newest', 200, 0);
  out := out || ('K3 private, no bypass: a pending application ' || case when r->>'access' = 'pending' and k = 1
      and l->'rows' @> jsonb_build_array(jsonb_build_object('id', nu)) then 'ok' else 'FAIL ' || r::text end);
  r := public.admin_connect_account(nu, 'instagram', 'probe029ig', vingo, true);
  select count(*) into k from public.campaign_applications where campaign_id = vingo and connected_account_id = (r->>'id')::uuid and status = 'approved';
  out := out || ('K4 bypass later approves that same request ' || case when r->>'result' = 'already' and r->>'access' = 'approved' and k = 1 then 'ok' else 'FAIL' end);
  r := public.admin_connect_account(nu2, 'tiktok', 'probe029tt', tal, true);
  select count(*) into k from public.campaign_applications where user_id = nu2;
  out := out || ('K5 public campaign: open, nothing to approve ' || case when r->>'access' = 'open' and k = 0 then 'ok' else 'FAIL ' || r::text end);
  select count(*) into k from public.connected_accounts where user_id = nu2 and handle = 'probe029yt2';
  begin perform public.admin_connect_account(nu2, 'tiktok', 'probe029yt2', vingo, true); out := out || 'K6 FAIL wrong platform accepted'::text;
  exception when invalid_parameter_value then
    select count(*) into k2 from public.connected_accounts where user_id = nu2 and handle = 'probe029yt2';
    out := out || ('K6 wrong platform for the campaign refused, nothing created ' || case when k2 = k then 'ok' else 'FAIL' end);
  end;
  r := public.admin_connect_account(nu2, 'youtube', 'probe029y3', null, true);
  out := out || ('K7 no campaign: just connected ' || case when r->>'result' = 'added' and r ? 'access' and r->'access' = 'null'::jsonb then 'ok' else 'FAIL ' || r::text end);

  -- ---------- J: profile ----------
  r := public.admin_creator_detail(cl);
  select count(*) into k from public.clip_submissions where user_id = cl and campaign_id = vingo::text;
  out := out || ('J1 profile lists their campaigns ' || case
      when r->'joined' @> jsonb_build_array(jsonb_build_object('campaign_id', vingo, 'clips', k, 'access', 'approved')) then 'ok' else 'FAIL' end);
  r := public.admin_creator_detail(nu);
  out := out || ('J2 profile of the bypassed creator shows Vingo ' || case
      when r->'joined' @> jsonb_build_array(jsonb_build_object('campaign_id', vingo)) then 'ok' else 'FAIL' end);
  perform set_config('request.jwt.claims', '', true);

  raise exception 'PROBE %', array_to_string(out, ' | ');
end $p$ language plpgsql;
revoke all on function cx_probe.p029() from public, anon, authenticated;
