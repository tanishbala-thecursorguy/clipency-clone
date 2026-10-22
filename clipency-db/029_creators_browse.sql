-- 029_creators_browse.sql
-- Creators section, browse mode: KPIs, a filterable list of every creator,
-- creators per campaign (with the accounts they use there and their access),
-- a "new sign-ups" feed of creators who never joined a campaign, and
-- connecting an account straight to a campaign with an optional bypass of the
-- application. Admin only (cx_is_admin). Idempotent.

-- 1. KPIs, all computed live.
create or replace function public.admin_creators_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  with cr as (select id, created_at from public.profiles where role = 'clipper')
  select jsonb_build_object(
    'creators', (select count(*) from cr),
    'with_accounts', (select count(distinct a.user_id) from public.connected_accounts a join cr on cr.id = a.user_id where a.status = 'verified'),
    'new_7d', (select count(*) from cr where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from cr where created_at > now() - interval '30 days'),
    'never_joined', (select count(*) from cr where not exists (select 1 from public.clip_submissions s where s.user_id = cr.id)
                                              and not exists (select 1 from public.campaign_applications ap where ap.user_id = cr.id)),
    'active_30d', (select count(distinct s.user_id) from public.clip_submissions s join cr on cr.id = s.user_id where s.created_at > now() - interval '30 days'),
    'platforms', (select jsonb_build_object(
        'instagram', count(*) filter (where a.platform = 'instagram'),
        'youtube', count(*) filter (where a.platform = 'youtube'),
        'tiktok', count(*) filter (where a.platform = 'tiktok'))
      from public.connected_accounts a join cr on cr.id = a.user_id where a.status = 'verified'),
    'pending_accounts', (select count(*) from public.connected_accounts a join cr on cr.id = a.user_id where a.status = 'pending'),
    'pending_applications', (select count(*) from public.campaign_applications where status = 'pending'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'status', c.status,
        'is_private', coalesce(c.is_private, false)) order by (c.status = 'active') desc, c.title)
      from public.campaigns c), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- 2. The list. p_view: 'all' | 'campaign' | 'new'.
--    p_segment (all view): 'all' | 'active' | 'no_accounts' | 'never_joined'.
--    p_access (campaign view): 'all' | 'approved' | 'pending' | 'rejected' | 'none'.
--    p_days (new view): only creators who signed up in the last N days (null = any).
create or replace function public.admin_list_creators(
  p_view text default 'all', p_campaign uuid default null, p_q text default null,
  p_platform text default null, p_segment text default 'all', p_access text default 'all',
  p_days int default null, p_sort text default 'newest', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := regexp_replace(lower(btrim(coalesce(p_q, ''))), '^@', ''); pat text; v_plat text := public.cx_platform_key(p_platform);
        lim int := greatest(1, least(coalesce(p_limit, 50), 200)); off int := greatest(0, coalesce(p_offset, 0));
        out jsonb; v_camp public.campaigns%rowtype;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_view, 'all') not in ('all', 'campaign', 'new') then raise exception 'Unknown view.' using errcode = '22023'; end if;
  if p_view = 'campaign' then
    select * into v_camp from public.campaigns where id = p_campaign;
    if not found then raise exception 'Pick a campaign.' using errcode = '22023'; end if;
  end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with cr as (
    select p.id, p.email, p.created_at,
           coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.display_name), ''), p.username) as name
    from public.profiles p where p.role = 'clipper'
  ),
  acc as (
    select a.user_id,
      count(*) filter (where a.status = 'verified' and a.platform = 'instagram') ig,
      count(*) filter (where a.status = 'verified' and a.platform = 'youtube') yt,
      count(*) filter (where a.status = 'verified' and a.platform = 'tiktok') tt,
      count(*) filter (where a.status = 'verified') v,
      count(*) filter (where a.status = 'pending') pend
    from public.connected_accounts a group by a.user_id
  ),
  cl as (
    select s.user_id, count(*) n, count(*) filter (where s.status = 'approved') ap,
      count(*) filter (where s.status = 'pending') pe,
      coalesce(sum(s.views_count) filter (where s.status = 'approved'), 0) views,
      max(s.created_at) last_at, count(distinct s.campaign_id) camps
    from public.clip_submissions s
    where p_view <> 'campaign' or s.campaign_id = p_campaign::text
    group by s.user_id
  ),
  apps as (
    select ap.user_id, count(*) n,
      count(*) filter (where ap.status = 'approved') appr, count(*) filter (where ap.status = 'pending') pend,
      count(*) filter (where ap.status = 'rejected') rej
    from public.campaign_applications ap
    where p_view <> 'campaign' or ap.campaign_id = p_campaign
    group by ap.user_id
  ),
  rws as (
    select cr.*, coalesce(acc.ig, 0) ig, coalesce(acc.yt, 0) yt, coalesce(acc.tt, 0) tt, coalesce(acc.v, 0) v,
      coalesce(acc.pend, 0) acc_pend,
      coalesce(cl.n, 0) clips, coalesce(cl.ap, 0) approved, coalesce(cl.pe, 0) pending, coalesce(cl.views, 0) views,
      cl.last_at, coalesce(cl.camps, 0) camps, coalesce(apps.n, 0) apps_n, coalesce(apps.appr, 0) apps_appr,
      coalesce(apps.pend, 0) apps_pend, coalesce(apps.rej, 0) apps_rej
    from cr left join acc on acc.user_id = cr.id left join cl on cl.user_id = cr.id left join apps on apps.user_id = cr.id
  ),
  f as (
    select * from rws r
    where (q = '' or lower(coalesce(r.email, '')) like pat or lower(coalesce(r.name, '')) like pat
           or exists (select 1 from public.connected_accounts a where a.user_id = r.id and lower(coalesce(a.handle, '')) like pat))
      and (v_plat is null or (v_plat = 'instagram' and r.ig > 0) or (v_plat = 'youtube' and r.yt > 0) or (v_plat = 'tiktok' and r.tt > 0))
      and case p_view
            when 'campaign' then (r.clips > 0 or r.apps_n > 0)
              and case coalesce(p_access, 'all')
                    when 'approved' then r.apps_appr > 0 when 'pending' then r.apps_pend > 0
                    when 'rejected' then r.apps_rej > 0 when 'none' then r.apps_n = 0 else true end
            when 'new' then r.clips = 0 and r.apps_n = 0
              and (p_days is null or r.created_at > now() - make_interval(days => p_days))
            else case coalesce(p_segment, 'all')
                   when 'active' then r.last_at > now() - interval '30 days'
                   when 'no_accounts' then r.v = 0
                   when 'never_joined' then r.clips = 0 and r.apps_n = 0
                   else true end
          end
  ),
  pg as (
    select * from (
      select f.*, row_number() over (order by
        case when p_sort = 'clips' then f.clips end desc nulls last,
        case when p_sort = 'views' then f.views end desc nulls last,
        case when p_sort = 'last' then f.last_at end desc nulls last,
        case when p_sort = 'oldest' then f.created_at end asc,
        f.created_at desc, f.id) ord
      from f) o
    where o.ord > off and o.ord <= off + lim
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'limit', lim, 'offset', off,
    'campaign', case when p_view = 'campaign' then jsonb_build_object(
        'id', v_camp.id, 'title', v_camp.title, 'status', v_camp.status, 'is_private', coalesce(v_camp.is_private, false),
        'platform', v_camp.platform, 'client_review', public.cx_client_review_on(v_camp.id::text),
        'creators', (select count(*) from f), 'clips', (select coalesce(sum(clips), 0) from f),
        'approved', (select coalesce(sum(approved), 0) from f), 'pending', (select coalesce(sum(pending), 0) from f),
        'views', (select coalesce(sum(views), 0) from f),
        'applications_pending', (select coalesce(sum(apps_pend), 0) from f)) end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.id, 'email', pg.email, 'name', pg.name, 'created_at', pg.created_at,
        'ig', pg.ig, 'yt', pg.yt, 'tt', pg.tt, 'verified', pg.v, 'accounts_pending', pg.acc_pend,
        'clips', pg.clips, 'approved', pg.approved, 'pending', pg.pending, 'views', pg.views,
        'last_clip_at', pg.last_at, 'campaigns', pg.camps,
        'campaign_accounts', case when p_view = 'campaign' then (
          select coalesce(jsonb_agg(x.j order by x.platform, x.handle), '[]'::jsonb) from (
            select coalesce(a.platform, lower(max(s.platform))) platform, coalesce(a.handle, max(s.handle)) handle,
              jsonb_build_object(
                'account_id', a.id, 'platform', coalesce(a.platform, lower(max(s.platform))),
                'handle', coalesce(a.handle, max(s.handle)), 'account_status', a.status,
                'app_id', (select ap.id from public.campaign_applications ap where ap.campaign_id = p_campaign and ap.connected_account_id = a.id),
                'access', (select ap.status from public.campaign_applications ap where ap.campaign_id = p_campaign and ap.connected_account_id = a.id),
                'clips', count(s.id), 'approved', count(s.id) filter (where s.status = 'approved'),
                'pending', count(s.id) filter (where s.status = 'pending'),
                'views', coalesce(sum(s.views_count) filter (where s.status = 'approved'), 0)) j
            from (
              select s0.connected_account_id aid from public.clip_submissions s0
               where s0.user_id = pg.id and s0.campaign_id = p_campaign::text
              union
              select ap0.connected_account_id from public.campaign_applications ap0
               where ap0.user_id = pg.id and ap0.campaign_id = p_campaign
            ) k
            left join public.connected_accounts a on a.id = k.aid
            left join public.clip_submissions s on s.user_id = pg.id and s.campaign_id = p_campaign::text
                   and s.connected_account_id is not distinct from k.aid
            group by a.id, a.platform, a.handle, a.status
          ) x) end
      ) order by pg.ord) from pg), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- 3. Profile: also which campaigns they are in and with which accounts.
do $do$
declare d text := pg_get_functiondef('public.admin_creator_detail(uuid)'::regprocedure);
  a text := $a$    'campaigns', coalesce(($a$;
  b text := $b$    'joined', coalesce((
      select jsonb_agg(j.x order by j.last_at desc nulls last)
      from (
        select max(coalesce(s.created_at, ap.created_at)) last_at, jsonb_build_object(
          'campaign_id', c.id, 'title', c.title, 'status', c.status, 'is_private', coalesce(c.is_private, false),
          'clips', count(distinct s.id), 'approved', count(distinct s.id) filter (where s.status = 'approved'),
          'pending', count(distinct s.id) filter (where s.status = 'pending'),
          'views', coalesce((select sum(s2.views_count) from public.clip_submissions s2
                              where s2.user_id = p.id and s2.campaign_id = c.id::text and s2.status = 'approved'), 0),
          'accounts', (select coalesce(jsonb_agg(distinct coalesce(a2.platform, lower(s3.platform)) || ' @' || regexp_replace(coalesce(a2.handle, s3.handle, ''), '^@', '')), '[]'::jsonb)
                         from public.clip_submissions s3 left join public.connected_accounts a2 on a2.id = s3.connected_account_id
                        where s3.user_id = p.id and s3.campaign_id = c.id::text),
          'access', (select string_agg(distinct ap2.status, ',') from public.campaign_applications ap2
                      where ap2.user_id = p.id and ap2.campaign_id = c.id)) x
        from public.campaigns c
        left join public.clip_submissions s on s.user_id = p.id and s.campaign_id = c.id::text
        left join public.campaign_applications ap on ap.user_id = p.id and ap.campaign_id = c.id
        where s.id is not null or ap.id is not null
        group by c.id
      ) j), '[]'::jsonb),
    'campaigns', coalesce(($b$;
begin
  if position('''joined''' in d) = 0 then
    if position(a in d) = 0 then raise exception 'admin_creator_detail anchor not found'; end if;
    execute replace(d, a, b);
  end if;
end $do$;

-- 4. Connect an account and, optionally, put it straight into a campaign.
--    Private campaign + bypass: approved now, no application to review.
--    Private campaign, no bypass: a pending application lands in Applications.
--    Public campaign: nothing to approve, it can submit right away.
create or replace function public.admin_connect_account(
  p_user uuid, p_platform text, p_handle text, p_campaign uuid default null, p_bypass boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; c public.campaigns%rowtype; v_acc uuid; v_access text; s text;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_campaign is not null then
    select * into c from public.campaigns where id = p_campaign;
    if not found then raise exception 'Campaign not found.' using errcode = 'P0002'; end if;
    s := lower(coalesce(c.platform, ''));
    if btrim(s) <> '' and s !~ 'all' and position(coalesce(public.cx_platform_key(p_platform), '?') in s) = 0 then
      raise exception '% does not take % clips.', c.title, initcap(coalesce(public.cx_platform_key(p_platform), p_platform)) using errcode = '22023';
    end if;
  end if;

  r := public.admin_add_connected_account(p_user, p_platform, p_handle);
  v_acc := (r->>'id')::uuid;
  if p_campaign is null then return r || jsonb_build_object('access', null); end if;

  if coalesce(c.is_private, false) then
    if coalesce(p_bypass, true) then
      perform public.admin_grant_campaign_access(v_acc, p_campaign);
      v_access := 'approved';
    else
      insert into public.campaign_applications (campaign_id, user_id, connected_account_id, status, attempt, note)
      values (p_campaign, p_user, v_acc, 'pending', 1, 'Added by admin')
      on conflict (campaign_id, connected_account_id) do nothing;
      select status into v_access from public.campaign_applications where campaign_id = p_campaign and connected_account_id = v_acc;
    end if;
  else
    v_access := 'open';
  end if;
  return r || jsonb_build_object('campaign_id', p_campaign, 'access', v_access);
end $$;

-- 5. Profile accounts: flag a handle that is also verified on another creator
--    (old data from before 027 refused that), so it is visible, not silent.
do $do$
declare d text := pg_get_functiondef('public.admin_creator_detail(uuid)'::regprocedure);
  a text := $a$'by_admin', coalesce(a.raw_profile->>'added_by', '') = 'admin',$a$;
  b text := $b$'by_admin', coalesce(a.raw_profile->>'added_by', '') = 'admin',
        'shared', (select count(distinct a3.user_id) from public.connected_accounts a3
                    where a3.status = 'verified' and a3.platform = a.platform and a3.user_id <> a.user_id
                      and lower(regexp_replace(coalesce(a3.handle, ''), '^@', '')) = lower(regexp_replace(coalesce(a.handle, ''), '^@', ''))),$b$;
begin
  if position('''shared''' in d) = 0 then
    if position(a in d) = 0 then raise exception 'admin_creator_detail shared anchor not found'; end if;
    execute replace(d, a, b);
  end if;
end $do$;

revoke all on function public.admin_creators_overview() from public, anon;
revoke all on function public.admin_list_creators(text, uuid, text, text, text, text, int, text, int, int) from public, anon;
revoke all on function public.admin_connect_account(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.admin_creators_overview() to authenticated;
grant execute on function public.admin_list_creators(text, uuid, text, text, text, text, int, text, int, int) to authenticated;
grant execute on function public.admin_connect_account(uuid, text, text, uuid, boolean) to authenticated;
