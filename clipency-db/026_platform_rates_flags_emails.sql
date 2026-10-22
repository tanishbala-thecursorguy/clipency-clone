-- 026: per-platform rates, $0 campaigns, no flags after approval, client emails per campaign.
--
-- 026a  campaigns.client_emails: client emails (clips waiting, reminder, weekly
--       report) only go out for campaigns switched on. Off by default; Vingo on.
--       Creator emails (approved, rejected, private invite) are not affected.
-- 026b  client_flag_clip refuses approved clips, whoever approved them and
--       whenever. Open flags are left as they are.
-- 026d  Per-platform rates. One campaign can pay creators a different rate on
--       each platform (YouTube $0, Instagram the normal rate) and bill the brand
--       its own price per platform. Rates are frozen on the clip at approval,
--       exactly like the campaign rate, so editing them never moves money that
--       is already earned. A platform with no row uses the campaign rate.
--
-- Function bodies that already exist are patched in place by anchored
-- replacements, so this file is safe to re-run against the live database.

-- ---------------------------------------------------------------- 026a
alter table public.campaigns add column if not exists client_emails boolean not null default false;
update public.campaigns set client_emails = true where id = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';

do $$ declare d text; anchor text := 'left join public.client_notify_prefs p on p.client_user_id = u.id'; begin
  d := pg_get_functiondef('public.cx_email_recipients()'::regprocedure);
  if position('client_emails' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception '026a anchor missing'; end if;
  execute replace(d, anchor, anchor || E'\n   where c.client_emails');
end $$;
revoke all on function public.cx_email_recipients() from public, anon, authenticated;

-- ---------------------------------------------------------------- 026b
do $$ declare d text; anchor text := 'if s.status = ''rejected'' then raise exception ''this clip is already rejected''; end if;'; begin
  d := pg_get_functiondef('public.client_flag_clip(uuid,text)'::regprocedure);
  if position('can no longer be flagged' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception '026b anchor missing'; end if;
  execute replace(d, anchor, anchor || E'\n  if s.status = ''approved'' then\n    raise exception ''This clip is approved, so it can no longer be flagged.'' using errcode = ''22023'';\n  end if;');
end $$;

-- ---------------------------------------------------------------- 026d
create or replace function public.cx_platform_key(p text)
returns text language sql immutable set search_path = public as $f$
  select case
    when p is null or btrim(p) = '' then null
    when lower(p) like '%insta%' or lower(btrim(p)) in ('ig', 'reels') then 'instagram'
    when lower(p) like '%youtu%' or lower(btrim(p)) in ('yt', 'shorts') then 'youtube'
    when lower(p) like '%tiktok%' or lower(btrim(p)) = 'tt' then 'tiktok'
    else lower(btrim(p)) end
$f$;

create table if not exists public.campaign_platform_rates (
  campaign_id           uuid not null references public.campaigns(id) on delete cascade,
  platform              text not null check (platform in ('instagram', 'youtube', 'tiktok')),
  rate_per_video        numeric not null default 0 check (rate_per_video >= 0),
  rpm                   numeric not null default 0 check (rpm >= 0),
  -- what the brand is billed; 0 means "the creator rate" (no margin on this platform)
  client_rate_per_video numeric not null default 0 check (client_rate_per_video >= 0),
  client_rpm            numeric not null default 0 check (client_rpm >= 0),
  updated_at            timestamptz not null default now(),
  primary key (campaign_id, platform),
  constraint cpr_brand_not_below_creator check (
    (client_rate_per_video = 0 or client_rate_per_video >= rate_per_video) and
    (client_rpm = 0 or client_rpm >= rpm))
);
-- Creator rates must never reach a client, and brand prices never a creator:
-- the table is staff-only and is read through the functions below.
alter table public.campaign_platform_rates enable row level security;
revoke all on public.campaign_platform_rates from anon, authenticated;

-- The rates that apply to a clip on this platform: the platform's own row, or the campaign's.
create or replace function public.cx_platform_rate(p_campaign uuid, p_platform text)
returns table (rate_per_video numeric, rpm numeric, client_rate_per_video numeric, client_rpm numeric, custom boolean)
language sql stable security definer set search_path = public as $f$
  select case when pr.campaign_id is not null then pr.rate_per_video else coalesce(c.rate_per_video, 0) end,
         case when pr.campaign_id is not null then pr.rpm else coalesce(c.rpm, 0) end,
         case when pr.campaign_id is not null then coalesce(nullif(pr.client_rate_per_video, 0), pr.rate_per_video)
              else public.campaign_client_unit_rate(c) end,
         case when pr.campaign_id is not null then coalesce(nullif(pr.client_rpm, 0), pr.rpm)
              else public.campaign_client_unit_rpm(c) end,
         pr.campaign_id is not null
    from public.campaigns c
    left join public.campaign_platform_rates pr
      on pr.campaign_id = c.id and pr.platform = public.cx_platform_key(p_platform)
   where c.id = p_campaign
$f$;
revoke all on function public.cx_platform_rate(uuid, text) from public, anon, authenticated;

-- What the brand is billed for one clip, in the campaign currency.
-- Same rules as before for a platform without its own row: per video, the brand
-- unit price; per view, the creator earning grossed up by the campaign ratio.
create or replace function public.cx_clip_client_cost(c public.campaigns, s public.clip_submissions)
returns numeric language plpgsql stable security definer set search_path = public as $f$
declare r record; earned numeric := coalesce(s.earning_amount_native, s.approved_amount, 0); v numeric;
begin
  select * into r from public.cx_platform_rate(c.id, s.platform);
  if coalesce(c.payout_model, 'per_view') = 'per_video' then
    return coalesce(r.client_rate_per_video, 0);
  end if;
  if not coalesce(r.custom, false) then
    return earned / greatest(public.campaign_rate_ratio(c), 0.000001);
  end if;
  if r.rpm > 0 then
    return round(earned * r.client_rpm / r.rpm, 2);
  end if;
  -- creators are not paid on this platform; the brand pays its own per-view price, if it has one
  if coalesce(r.client_rpm, 0) <= 0 then return 0; end if;
  v := coalesce(s.views_count, 0);
  if v < coalesce(c.min_views_per_clip, 0) then return 0; end if;
  if coalesce(c.max_views_per_clip, 0) > 0 and v > c.max_views_per_clip then v := c.max_views_per_clip; end if;
  return round(v / 1000000.0 * r.client_rpm, 2);
end $f$;
revoke all on function public.cx_clip_client_cost(public.campaigns, public.clip_submissions) from public, anon, authenticated;

-- Brand spend on a campaign so far: the sum over its approved clips.
create or replace function public.cx_campaign_client_spent(c public.campaigns)
returns numeric language sql stable security definer set search_path = public as $f$
  select coalesce(sum(public.cx_clip_client_cost(c, s)), 0)
    from public.clip_submissions s
   where s.campaign_id = c.id::text and s.status = 'approved'
$f$;
revoke all on function public.cx_campaign_client_spent(public.campaigns) from public, anon, authenticated;

-- Staff: read and replace a campaign's platform rates.
create or replace function public.admin_platform_rates()
returns setof public.campaign_platform_rates language plpgsql stable security definer set search_path = public as $f$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select * from public.campaign_platform_rates order by campaign_id, platform;
end $f$;
revoke all on function public.admin_platform_rates() from public, anon;
grant execute on function public.admin_platform_rates() to authenticated;

-- Removes a campaign's platform rows except the ones listed (internal, called below).
create or replace function public.cx_platform_rates_prune(p_campaign uuid, p_keep text[])
returns void language plpgsql security definer set search_path = public as $f$
begin
  delete from public.campaign_platform_rates where campaign_id = p_campaign and not (platform = any(coalesce(p_keep, array[]::text[])));
end $f$;
revoke all on function public.cx_platform_rates_prune(uuid, text[]) from public, anon, authenticated;

-- p_rates: [{platform, rate_per_video, rpm, client_rate_per_video, client_rpm}], in the
-- campaign currency (rpm per 1M views). Platforms left out go back to the campaign rate.
create or replace function public.admin_set_platform_rates(p_campaign uuid, p_rates jsonb)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare r record; k text; seen text[] := array[]::text[];
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.campaigns where id = p_campaign) then raise exception 'Campaign not found'; end if;
  for r in select * from jsonb_to_recordset(coalesce(p_rates, '[]'::jsonb))
             as y(platform text, rate_per_video numeric, rpm numeric, client_rate_per_video numeric, client_rpm numeric)
  loop
    k := public.cx_platform_key(r.platform);
    if k is null or k not in ('instagram', 'youtube', 'tiktok') then
      raise exception 'Unknown platform: %', r.platform using errcode = '22023';
    end if;
    if k = any(seen) then raise exception 'Platform listed twice: %', k using errcode = '22023'; end if;
    seen := seen || k;
    insert into public.campaign_platform_rates as t
      (campaign_id, platform, rate_per_video, rpm, client_rate_per_video, client_rpm, updated_at)
    values (p_campaign, k,
            round(greatest(coalesce(r.rate_per_video, 0), 0), 2),
            round(greatest(coalesce(r.rpm, 0), 0), 2),
            round(greatest(coalesce(r.client_rate_per_video, 0), 0), 2),
            round(greatest(coalesce(r.client_rpm, 0), 0), 2),
            now())
    on conflict (campaign_id, platform) do update set
      rate_per_video = excluded.rate_per_video, rpm = excluded.rpm,
      client_rate_per_video = excluded.client_rate_per_video, client_rpm = excluded.client_rpm,
      updated_at = now();
  end loop;
  perform public.cx_platform_rates_prune(p_campaign, seen);
  return coalesce((select jsonb_agg(to_jsonb(t) order by t.platform) from public.campaign_platform_rates t
                   where t.campaign_id = p_campaign), '[]'::jsonb);
end $f$;
revoke all on function public.admin_set_platform_rates(uuid, jsonb) from public, anon;
grant execute on function public.admin_set_platform_rates(uuid, jsonb) to authenticated;

-- Creators: what each platform pays on a campaign they can see. Never the brand price,
-- and nothing for a client of that campaign. Private campaigns only for approved creators.
create or replace function public.cx_campaign_creator_rates(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare c public.campaigns%rowtype;
begin
  if auth.uid() is null then return null; end if;
  select * into c from public.campaigns where id = p_campaign;
  if not found then return null; end if;
  if not public.cx_is_staff() then
    if public.cx_is_campaign_client(c.id) or c.client_user_id = auth.uid() then return null; end if;
    if coalesce(c.is_private, false) and not public.cx_is_approved_for_campaign(c.id) then return null; end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
             'platform', pr.platform,
             'payout_model', coalesce(c.payout_model, 'per_view'),
             'rate', case when coalesce(c.payout_model, 'per_view') = 'per_video' then pr.rate_per_video else pr.rpm end)
           order by pr.platform)
           from public.campaign_platform_rates pr where pr.campaign_id = c.id), '[]'::jsonb);
end $f$;
revoke all on function public.cx_campaign_creator_rates(uuid) from public, anon;
grant execute on function public.cx_campaign_creator_rates(uuid) to authenticated;

-- Settlement: freeze the platform's rate on the clip at approval.
do $$ declare d text; begin
  d := pg_get_functiondef('public.cs_calc_earning()'::regprocedure);
  if position('cx_platform_rate' in d) > 0 then return; end if;
  if position('model text; rate numeric; fx numeric;' in d) = 0
     or position('from public.campaigns c where c.id::text = new.campaign_id;' in d) = 0 then
    raise exception '026d cs_calc_earning anchors missing';
  end if;
  d := replace(d, 'model text; rate numeric; fx numeric;', 'model text; rate numeric; fx numeric; p_custom boolean; p_rpv numeric; p_rpm numeric;');
  d := replace(d, 'from public.campaigns c where c.id::text = new.campaign_id;',
    'from public.campaigns c where c.id::text = new.campaign_id;' || E'\n\n' ||
    '  /* A platform with its own rate (YouTube at 0, say) pays that rate instead. */' || E'\n' ||
    '  select x.custom, x.rate_per_video, x.rpm into p_custom, p_rpv, p_rpm' || E'\n' ||
    '    from public.cx_platform_rate((select c2.id from public.campaigns c2 where c2.id::text = new.campaign_id),' || E'\n' ||
    '                                 new.platform) x;' || E'\n' ||
    '  if coalesce(p_custom, false) then c_per_video := p_rpv; c_rpm := p_rpm; end if;');
  execute d;
end $$;

-- Per-video settlement: a clip with no frozen rate falls back to its platform rate, not the campaign's.
do $$ declare d text; anchor text := 'v_rate := coalesce(r.rate_per_video_at_approval, c.rate_per_video, 0);'; begin
  d := pg_get_functiondef('public.cx_settle_creator_campaign(uuid,text)'::regprocedure);
  if position('cx_platform_rate' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception '026d settle anchor missing'; end if;
  execute replace(d, anchor,
    'v_rate := coalesce(r.rate_per_video_at_approval,' || E'\n' ||
    '                       (select pr.rate_per_video from public.cx_platform_rate(c.id, r.platform) pr), 0);');
end $$;

-- Currency switch converts platform rates with everything else.
do $$ declare d text; anchor text := 'update public.campaign_secrets set'; begin
  d := pg_get_functiondef('public.admin_convert_campaign_currency(uuid,text)'::regprocedure);
  if position('campaign_platform_rates' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then raise exception '026d convert anchor missing'; end if;
  execute replace(d, anchor,
    'update public.campaign_platform_rates set' || E'\n' ||
    '    rate_per_video = round(rate_per_video * k, 2), rpm = round(rpm * k, 2),' || E'\n' ||
    '    client_rate_per_video = round(client_rate_per_video * k, 2), client_rpm = round(client_rpm * k, 2),' || E'\n' ||
    '    updated_at = now()' || E'\n' ||
    '  where campaign_id = p_campaign;' || E'\n  ' || anchor);
end $$;

-- Brand spend everywhere the client sees it: per clip, at the platform's brand price.
do $$ declare d text; n int; begin
  d := pg_get_functiondef('public.client_dashboard_data()'::regprocedure);
  if position('cx_campaign_client_spent' in d) > 0 then return; end if;
  -- campaign card spend
  n := length(d);
  d := replace(d,
$a$        select case when coalesce(c.payout_model,'per_view') = 'per_video'
                    then (select count(*) from public.clip_submissions s
                           where s.campaign_id = c.id::text and s.status = 'approved') * unit
                    else coalesce(c.budget_used,0) / ratio end as spent_native) sp$a$,
$a$        select public.cx_campaign_client_spent(c) as spent_native) sp$a$);
  if length(d) = n then raise exception '026d dashboard anchor 1 missing'; end if;
  -- per-clip cost
  n := length(d);
  d := replace(d,
$a$               'earned', case when pv
                              then round(public.campaign_client_unit_rate(c)
                                         / greatest(coalesce(c.fx_rate_per_usd,1),0.000001), 2)
                              else round(coalesce(s.approved_amount,0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,
               'earned_native', case when pv
                              then round(public.campaign_client_unit_rate(c), 2)
                              else round(coalesce(s.earning_amount_native, s.approved_amount, 0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,$a$,
$a$               'earned', round(public.cx_clip_client_cost(c, s)
                               / greatest(coalesce(c.fx_rate_per_usd,1),0.000001), 2),
               'earned_native', round(public.cx_clip_client_cost(c, s), 2),$a$);
  if length(d) = n then raise exception '026d dashboard anchor 2 missing'; end if;
  -- totals
  n := length(d);
  d := replace(d,
$a$        'spent',        coalesce(sum(round(
                          case when coalesce(c.payout_model,'per_view') = 'per_video'
                               then (select count(*) from public.clip_submissions s
                                      where s.campaign_id = c.id::text and s.status = 'approved')
                                    * public.campaign_client_unit_rate(c)
                               else coalesce(c.budget_used,0)
                                    / greatest(public.campaign_rate_ratio(c),0.000001) end
                          / f.fx, 2)),0)$a$,
$a$        'spent',        coalesce(sum(round(public.cx_campaign_client_spent(c) / f.fx, 2)),0)$a$);
  if length(d) = n then raise exception '026d dashboard anchor 3 missing'; end if;
  execute d;
end $$;

do $$ declare d text; n int; begin
  d := pg_get_functiondef('public.cx_weekly_payload(uuid,text)'::regprocedure);
  if position('cx_campaign_client_spent' in d) > 0 then return; end if;
  n := length(d);
  d := replace(d,
$a$  spent := case when coalesce(c.payout_model, 'per_view') = 'per_video' then live * unit
                else coalesce(c.budget_used, 0) / greatest(public.campaign_rate_ratio(c), 0.000001) end;$a$,
$a$  spent := public.cx_campaign_client_spent(c);$a$);
  if length(d) = n then raise exception '026d weekly anchor missing'; end if;
  execute d;
end $$;
revoke all on function public.cx_weekly_payload(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 026e
-- Campaign cards on the creator dashboard show creators and total views only
-- (no rate, no budget). campaigns.total_views is kept by the same trigger that
-- keeps creators_count: approved clips' views.
alter table public.campaigns add column if not exists total_views bigint not null default 0;
do $$ declare d text; a text := 'set creators_count = v_unique_clippers,'; begin
  d := pg_get_functiondef('public.sync_campaign_stats_on_submission()'::regprocedure);
  if position('total_views    =' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception '026e sync anchor missing'; end if;
  execute replace(d, a, a || E'\n      total_views    = v_total_views::bigint,');
end $$;
do $$ declare d text; a text := $x$'creators_count', coalesce(c.creators_count,0),$x$; begin
  d := pg_get_functiondef('public.cx_private_campaign_teasers()'::regprocedure);
  if position('total_views' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception '026e teaser anchor missing'; end if;
  execute replace(d, a, a || E'\n      ''total_views'', coalesce(c.total_views,0),');
end $$;
update public.campaigns c set total_views = x.v
  from (select c2.id, coalesce((select sum(s.views_count) from public.clip_submissions s
                                 where s.campaign_id = c2.id::text and s.status = 'approved'), 0)::bigint v
          from public.campaigns c2) x
 where x.id = c.id and c.total_views is distinct from x.v;
