-- 027_admin_creators.sql
-- Admin "Creators" section: find a creator, see their connected accounts per
-- platform, connect an account by username (no bio code), approve campaign
-- access, and bulk-submit clip links on their behalf.
--
-- Bulk-submitted clips are ordinary pending clip_submissions rows, so every
-- existing trigger applies: duplicate-post guard, private-campaign guard,
-- review_due stamping (puts them in the brand's Review queue when client
-- review is on), earnings and campaign stats.
--
-- Admin only (cx_is_admin), not reviewers. Idempotent. Run each statement
-- block on its own when using the Supabase MCP.

-- 1. Handle normaliser: accepts "@name", "name" or a profile URL.
create or replace function public.cx_norm_handle(p_raw text)
returns text language plpgsql immutable set search_path = public as $$
declare h text := btrim(coalesce(p_raw, ''));
begin
  h := regexp_replace(h, '^(https?://)?(www\.|m\.)?(instagram\.com|tiktok\.com|youtube\.com)/', '', 'i');
  h := regexp_replace(h, '^(c|user)/', '', 'i');
  if h ~* '^channel/' then return null; end if;
  h := regexp_replace(h, '[/?#].*$', '');
  h := regexp_replace(h, '^@', '');
  if h !~ '^[A-Za-z0-9._-]{1,64}$' then return null; end if;
  return h;
end $$;

-- 2. Search creators by email, name, username or a connected handle.
create or replace function public.admin_find_creators(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := lower(btrim(coalesce(p_q, ''))); pat text;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(x.j order by x.exact desc, x.email)
    from (
      select lower(p.email) = q as exact, p.email,
        jsonb_build_object(
          'id', p.id, 'email', p.email, 'role', p.role, 'username', p.username,
          'name', coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.display_name), ''), p.username),
          'accounts', (select count(*) from public.connected_accounts a
                        where a.user_id = p.id and a.status = 'verified')) j
      from public.profiles p
      where lower(coalesce(p.email, '')) like pat
         or lower(coalesce(p.username, '')) like pat
         or lower(coalesce(p.full_name, '')) like pat
         or exists (select 1 from public.connected_accounts a
                     where a.user_id = p.id and lower(coalesce(a.handle, '')) like pat)
      order by lower(p.email) = q desc, p.email
      limit 20
    ) x), '[]'::jsonb);
end $$;

-- 3. Everything the Creators page shows for one creator.
create or replace function public.admin_creator_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'username', p.username,
       'name', coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.display_name), ''), p.username),
       'created_at', p.created_at),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'platform', a.platform, 'handle', coalesce(a.handle, a.username),
        'status', a.status, 'verified_at', a.verified_at, 'created_at', a.created_at,
        'rejection_reason', a.rejection_reason,
        'by_admin', coalesce(a.raw_profile->>'added_by', '') = 'admin',
        'clips', (select count(*) from public.clip_submissions s
                   where s.connected_account_id = a.id and s.status is distinct from 'rejected'))
        order by a.platform, (a.status = 'verified') desc, a.created_at desc)
      from public.connected_accounts a where a.user_id = p.id), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ap.id, 'campaign_id', ap.campaign_id, 'campaign_title', c.title,
        'account_id', ap.connected_account_id, 'account_handle', a.handle, 'account_platform', a.platform,
        'status', ap.status, 'note', ap.note, 'rejection_reason', ap.rejection_reason,
        'attempt', ap.attempt, 'created_at', ap.created_at)
        order by (ap.status = 'pending') desc, ap.created_at desc)
      from public.campaign_applications ap
      join public.campaigns c on c.id = ap.campaign_id
      left join public.connected_accounts a on a.id = ap.connected_account_id
      where ap.user_id = p.id), '[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'campaign_id', s.campaign_id, 'campaign_title', s.campaign_title,
        'platform', s.platform, 'handle', s.handle, 'clip_url', s.clip_url, 'status', s.status,
        'review_due_at', s.review_due_at, 'review_source', s.review_source,
        'views', s.views_count, 'created_at', s.created_at, 'rejection_reason', s.rejection_reason)
        order by s.created_at desc)
      from (select * from public.clip_submissions s0 where s0.user_id = p.id
             order by s0.created_at desc limit 100) s), '[]'::jsonb),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'brand', c.brand_name, 'platform', c.platform,
        'is_private', coalesce(c.is_private, false),
        'client_review', public.cx_client_review_on(c.id::text))
        order by c.title)
      from public.campaigns c where c.status = 'active'), '[]'::jsonb)
  ) into out
  from public.profiles p where p.id = p_user;
  if out is null then raise exception 'Creator not found.' using errcode = 'P0002'; end if;
  return out;
end $$;

-- 4. Connect an account by username. Staff vouch for it, so it is verified
--    straight away with no bio code.
create or replace function public.admin_add_connected_account(p_user uuid, p_platform text, p_handle text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plat text := public.cx_platform_key(p_platform);
        v_h text := public.cx_norm_handle(p_handle);
        v_other text; r public.connected_accounts%rowtype; v_id uuid;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_plat is null or v_plat not in ('instagram', 'youtube', 'tiktok') then
    raise exception 'Pick YouTube, Instagram or TikTok.' using errcode = '22023';
  end if;
  if v_h is null then
    raise exception 'That is not a username. Type the handle (like @name) or paste the profile link.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Creator not found.' using errcode = 'P0002';
  end if;

  select p.email into v_other
    from public.connected_accounts a join public.profiles p on p.id = a.user_id
   where a.platform = v_plat and a.status = 'verified' and a.user_id <> p_user
     and lower(regexp_replace(coalesce(a.handle, ''), '^@', '')) = lower(v_h)
   limit 1;
  if v_other is not null then
    raise exception '@% on % is already connected to another creator (%).', v_h, v_plat, v_other using errcode = '23505';
  end if;

  select * into r from public.connected_accounts a
   where a.user_id = p_user and a.platform = v_plat
     and lower(regexp_replace(coalesce(a.handle, ''), '^@', '')) = lower(v_h)
   order by (a.status = 'verified') desc, a.created_at
   limit 1;

  if found then
    if r.status = 'verified' then
      return jsonb_build_object('id', r.id, 'platform', v_plat, 'handle', r.handle, 'result', 'already');
    end if;
    update public.connected_accounts
       set status = 'verified', is_verified = true, verified_at = now(), verified_by = auth.uid(),
           rejection_reason = null, verify_error = null, updated_at = now(),
           raw_profile = coalesce(raw_profile, '{}'::jsonb) || jsonb_build_object('added_by', 'admin')
     where id = r.id;
    return jsonb_build_object('id', r.id, 'platform', v_plat, 'handle', r.handle, 'result', 'verified');
  end if;

  insert into public.connected_accounts
    (user_id, platform, handle, username, profile_url, status, is_verified, verified_at, verified_by, raw_profile)
  values
    (p_user, v_plat, v_h, v_h,
     case v_plat when 'instagram' then 'https://www.instagram.com/' || v_h || '/'
                 when 'tiktok' then 'https://www.tiktok.com/@' || v_h
                 else 'https://www.youtube.com/@' || v_h end,
     'verified', true, now(), auth.uid(), jsonb_build_object('added_by', 'admin'))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'platform', v_plat, 'handle', v_h, 'result', 'added');
end $$;

-- 5. Give an account access to a (private) campaign: create or approve its application.
create or replace function public.admin_grant_campaign_access(p_account uuid, p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare acc public.connected_accounts%rowtype; v_id uuid;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into acc from public.connected_accounts where id = p_account;
  if not found then raise exception 'Account not found.' using errcode = 'P0002'; end if;
  if acc.status <> 'verified' then raise exception 'Verify this account first.' using errcode = '22023'; end if;
  if not exists (select 1 from public.campaigns where id = p_campaign) then
    raise exception 'Campaign not found.' using errcode = 'P0002';
  end if;

  insert into public.campaign_applications
    (campaign_id, user_id, connected_account_id, status, attempt, reviewed_by, reviewed_at, note)
  values (p_campaign, acc.user_id, acc.id, 'approved', 1, auth.uid(), now(), 'Added by admin')
  on conflict (campaign_id, connected_account_id) do update
     set status = 'approved', rejection_reason = null, reviewed_by = auth.uid(),
         reviewed_at = now(), updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'approved');
end $$;

-- 6. Bulk submit. One result per link; a bad link never blocks the good ones.
create or replace function public.admin_bulk_submit_clips(p_user uuid, p_account uuid, p_campaign uuid, p_urls text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare acc public.connected_accounts%rowtype; c public.campaigns%rowtype;
        u text; k text; kp text; v_id uuid; v_due timestamptz;
        seen text[] := '{}'; res jsonb := '[]'::jsonb; n_ok int := 0;
        allowed text; disp text; v_email text;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into acc from public.connected_accounts where id = p_account and user_id = p_user;
  if not found then raise exception 'That account does not belong to this creator.' using errcode = '22023'; end if;
  if acc.status <> 'verified' then raise exception 'Verify this account before submitting clips from it.' using errcode = '22023'; end if;
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'Campaign not found.' using errcode = 'P0002'; end if;
  if c.status <> 'active' then raise exception 'This campaign is not active. Activate it before submitting clips.' using errcode = '22023'; end if;

  allowed := lower(coalesce(c.platform, ''));
  if btrim(allowed) <> '' and allowed !~ 'all' and position(acc.platform in allowed) = 0 then
    raise exception 'This campaign does not take % clips.', initcap(acc.platform) using errcode = '22023';
  end if;
  if coalesce(array_length(p_urls, 1), 0) = 0 then raise exception 'Paste at least one link.' using errcode = '22023'; end if;
  if array_length(p_urls, 1) > 100 then raise exception 'Up to 100 links at a time.' using errcode = '22023'; end if;

  disp := case acc.platform when 'instagram' then 'Instagram' when 'youtube' then 'YouTube' else 'TikTok' end;
  perform set_config('clipency.bulk_submit', '1', true);

  foreach u in array p_urls loop
    u := btrim(coalesce(u, ''));
    continue when u = '';
    k := public.cx_clip_key(u);
    if k is null or not public.cx_is_post_url(u) then
      res := res || jsonb_build_object('url', u, 'ok', false, 'error', 'Not a link to a single post.');
      continue;
    end if;
    kp := case when k like 'ig:%' then 'instagram' when k like 'yt:%' then 'youtube'
               when k like 'tt:%' or k ~* '^url:[a-z]*\.?tiktok\.com' then 'tiktok' end;
    if kp is distinct from acc.platform then
      res := res || jsonb_build_object('url', u, 'ok', false,
        'error', 'That is ' || case kp when 'instagram' then 'an Instagram' when 'youtube' then 'a YouTube'
                                  when 'tiktok' then 'a TikTok' else 'another platform''s' end
                 || ' link, but this account is ' || disp || '.');
      continue;
    end if;
    if k = any(seen) then
      res := res || jsonb_build_object('url', u, 'ok', false, 'error', 'Listed twice in this batch.');
      continue;
    end if;
    seen := seen || k;
    begin
      insert into public.clip_submissions
        (user_id, connected_account_id, campaign_id, campaign_title, platform, handle, clip_url, status)
      values (p_user, acc.id, c.id::text, c.title, disp, acc.handle, u, 'pending')
      returning id, review_due_at into v_id, v_due;
      n_ok := n_ok + 1;
      res := res || jsonb_build_object('url', u, 'ok', true, 'id', v_id, 'review_due_at', v_due);
    exception when others then
      res := res || jsonb_build_object('url', u, 'ok', false, 'error', sqlerrm);
    end;
  end loop;

  perform set_config('clipency.bulk_submit', '', true);

  if n_ok > 0 then
    begin
      select email into v_email from public.profiles where id = p_user;
      perform public.tg_send('thread_ops',
        '<b>Bulk clip submission</b>' || chr(10) ||
        '<b>Clipper:</b> ' || coalesce(v_email, '-') || chr(10) ||
        '<b>Campaign:</b> ' || coalesce(c.title, '-') || chr(10) ||
        '<b>Account:</b> ' || disp || ' @' || coalesce(acc.handle, '-') || chr(10) ||
        '<b>Clips:</b> ' || n_ok);
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('submitted', n_ok, 'failed', jsonb_array_length(res) - n_ok,
    'client_review', public.cx_client_review_on(c.id::text), 'results', res);
end $$;

revoke all on function public.cx_norm_handle(text) from public, anon;
revoke all on function public.admin_find_creators(text) from public, anon;
revoke all on function public.admin_creator_detail(uuid) from public, anon;
revoke all on function public.admin_add_connected_account(uuid, text, text) from public, anon;
revoke all on function public.admin_grant_campaign_access(uuid, uuid) from public, anon;
revoke all on function public.admin_bulk_submit_clips(uuid, uuid, uuid, text[]) from public, anon;
grant execute on function public.admin_find_creators(text) to authenticated;
grant execute on function public.admin_creator_detail(uuid) to authenticated;
grant execute on function public.admin_add_connected_account(uuid, text, text) to authenticated;
grant execute on function public.admin_grant_campaign_access(uuid, uuid) to authenticated;
grant execute on function public.admin_bulk_submit_clips(uuid, uuid, uuid, text[]) to authenticated;

-- 7. One Telegram summary per bulk batch instead of one message per clip.
do $do$
declare d text := pg_get_functiondef('public.tg_notify_new_submission'::regproc);
begin
  if position('clipency.bulk_submit' in d) = 0 then
    d := replace(d, E'begin\n  select email into v_email',
      E'begin\n  if coalesce(current_setting(''clipency.bulk_submit'', true), '''') = ''1'' then return NEW; end if;\n  select email into v_email');
    if position('clipency.bulk_submit' in d) = 0 then raise exception 'tg_notify_new_submission anchor not found'; end if;
    execute d;
  end if;
end $do$;
