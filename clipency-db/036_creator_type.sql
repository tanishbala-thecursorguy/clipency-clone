-- 036: creator type (UGC creator / clipper). Add-only: a new table and new
-- functions; no existing table, function, trigger or row is changed.
--
-- * creator_types: one row per creator who has picked. No row = not picked yet
--   (the dashboard asks on first login and lets them switch in Profile).
-- * Which campaigns are UGC is read from what's already there (title / genre /
--   category / campaign_type mention "ugc"), the same rule the dashboard uses.
-- * Shared helpers for 037/038: cx_display_name, cx_is_campaign_member.
--
-- Auto-submit (linked accounts adding clips by themselves) is NOT in here: it
-- would add rows to clip_submissions and waits for the owner's go-ahead.
--
-- Safe to re-run.

begin;

create table if not exists public.creator_types (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creator_type text not null check (creator_type in ('ugc','clipper')),
  updated_at timestamptz not null default now()
);
alter table public.creator_types enable row level security;
revoke all on public.creator_types from anon, authenticated;
grant select on public.creator_types to authenticated;
drop policy if exists creator_types_own on public.creator_types;
create policy creator_types_own on public.creator_types for select to authenticated using (user_id = auth.uid() or public.cx_is_staff());

-- ---------- shared helpers ----------
create or replace function public.cx_display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''),
                  split_part(coalesce(p.email, u.email, ''), '@', 1), 'Creator')
    from (select p_user as id) x
    left join public.profiles p on p.id = x.id
    left join auth.users u on u.id = x.id
$$;

-- someone is "in" a campaign if they have posted a clip to it or were approved for it
create or replace function public.cx_is_campaign_member(p_user uuid, p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.clip_submissions s where s.user_id = p_user and s.campaign_id = p_campaign::text)
      or exists (select 1 from public.campaign_applications a where a.user_id = p_user and a.campaign_id = p_campaign and a.status = 'approved')
$$;

create or replace function public.cx_is_ugc_campaign(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (concat_ws(' ', c.category, c.genre, c.campaign_type, c.title)) ~* 'ugc'
                     from public.campaigns c where c.id = p_campaign), false)
$$;

-- ---------- creator RPCs ----------
create or replace function public.creator_get_type() returns text
language sql stable security definer set search_path = public as $$
  select creator_type from public.creator_types where user_id = auth.uid()
$$;

create or replace function public.creator_set_type(p_type text) returns jsonb
language plpgsql security definer set search_path = public as $f$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_type is null or p_type not in ('ugc','clipper') then raise exception 'Pick UGC creator or Clipper'; end if;
  insert into public.creator_types (user_id, creator_type) values (auth.uid(), p_type)
  on conflict (user_id) do update set creator_type = excluded.creator_type, updated_at = now();
  return jsonb_build_object('creator_type', p_type);
end $f$;

-- UGC campaigns this creator can post to (active; private ones only once approved)
create or replace function public.ugc_campaigns() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'brand_name', c.brand_name, 'platform', c.platform,
                                               'asset_url', c.asset_url, 'is_private', c.is_private) order by c.created_at desc), '[]'::jsonb)
    from public.campaigns c
   where c.status = 'active' and public.cx_is_ugc_campaign(c.id)
     and (not coalesce(c.is_private, false) or public.cx_is_campaign_member(auth.uid(), c.id))
$$;

-- ---------- grants ----------
revoke all on function public.cx_display_name(uuid), public.cx_is_campaign_member(uuid, uuid), public.cx_is_ugc_campaign(uuid) from public, anon;
grant execute on function public.cx_display_name(uuid), public.cx_is_campaign_member(uuid, uuid), public.cx_is_ugc_campaign(uuid) to authenticated, service_role;
revoke all on function public.creator_get_type(), public.creator_set_type(text), public.ugc_campaigns() from public, anon;
grant execute on function public.creator_get_type(), public.creator_set_type(text), public.ugc_campaigns() to authenticated;

commit;
