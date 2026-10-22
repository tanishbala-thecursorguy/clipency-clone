-- 038: campaign group chats. One room per campaign: the client, every creator in
-- the campaign, and Clipency.
--
-- Matches what clipency-groupchat.js expects:
--   gc_list(), gc_status(campaign), gc_set_enabled(campaign, on), gc_messages(campaign),
--   gc_post(campaign, body, image_url), and for Clipency: gc_delete_message(id),
--   gc_set_paused(campaign, on), gc_ban(campaign, user, banned)
--
-- Rules (same as the offline demo and the UI):
-- * Off until the client (or Clipency) turns it on. While off, creators can't see it.
-- * Free. Nothing is billed or written to the client wallet.
-- * Add-only: new tables and functions; nothing existing is changed.
-- * Messages are deleted 12 hours after they're sent (cx_gc_purge(), every 15 min).
-- * No contact details or payment talk (Clipency may talk money). Links: social only
--   (Instagram, YouTube, Facebook, TikTok); the client and Clipency may also share
--   Google Drive / Docs links for briefs.
-- * Clipency can delete messages, pause a room, and remove people.
-- * Who's "in" a campaign: anyone who posted a clip to it or was approved for it
--   (cx_is_campaign_member, 036).
--
-- Safe to re-run.

begin;

-- ---------- tables ----------
create table if not exists public.campaign_chats (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  enabled boolean not null default false,
  paused boolean not null default false,
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_chat_bans (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null,
  banned_by uuid,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

create table if not exists public.campaign_chat_reads (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null,
  seen_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, user_id)
);

create table if not exists public.campaign_chat_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sender_id uuid,
  sender_role text not null check (sender_role in ('creator','client','admin','system')),
  sender_name text,
  body text not null default '',
  image_url text,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_gc_messages_room on public.campaign_chat_messages (campaign_id, created_at);
create index if not exists idx_gc_messages_age on public.campaign_chat_messages (created_at);

-- ---------- settings ----------
create or replace function public.cx_gc_ttl_hours() returns int language sql immutable as $$ select 12 $$;

-- ---------- helpers ----------
-- the caller's place in a campaign's room: 'admin' | 'client' | 'creator' | null
create or replace function public.cx_gc_role(p_campaign uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or not exists (select 1 from public.campaigns where id = p_campaign) then null
    when public.cx_is_staff() then 'admin'
    when public.cx_is_campaign_client(p_campaign) then 'client'
    when exists (select 1 from public.campaign_chat_bans b where b.campaign_id = p_campaign and b.user_id = auth.uid()) then null
    when public.cx_is_campaign_member(auth.uid(), p_campaign) then 'creator'
  end
$$;

-- can the caller read this room right now (RLS + Realtime use this)
create or replace function public.cx_gc_can_read(p_campaign uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.cx_gc_role(p_campaign)
    when 'admin' then true when 'client' then true
    when 'creator' then coalesce((select enabled from public.campaign_chats where campaign_id = p_campaign), false)
    else false end
$$;

create or replace function public.cx_gc_violation(p_text text, p_role text) returns text
language plpgsql immutable as $f$
declare t text := coalesce(p_text, ''); bad text; u text;
        hosts text := 'instagram\.com|instagr\.am|youtube\.com|youtu\.be|facebook\.com|fb\.com|fb\.watch|tiktok\.com|vm\.tiktok\.com|clipency\.in';
begin
  -- contact rules from 037 (its link rule is replaced by the one below)
  bad := public.cx_chat_violation(regexp_replace(t, 'https?://\S+', ' ', 'gi'), p_role = 'admin');
  if bad <> '' then return bad; end if;
  if p_role <> 'creator' then hosts := hosts || '|drive\.google\.com|docs\.google\.com'; end if;
  for u in select m[1] from regexp_matches(t, '(https?://\S+)', 'gi') m loop
    if u !~* ('^https?://(?:www\.|m\.)?(?:' || hosts || ')(?:[/?#]|$)') then
      return case when p_role = 'creator' then 'outside links (only Instagram, YouTube, Facebook and TikTok links)'
                  else 'outside links (only Instagram, YouTube, Facebook, TikTok and Google Drive/Docs links)' end;
    end if;
  end loop;
  return '';
end $f$;

create or replace function public.cx_gc_room(p_campaign uuid) returns public.campaign_chats
language plpgsql security definer set search_path = public as $f$
declare r public.campaign_chats;
begin
  insert into public.campaign_chats (campaign_id) values (p_campaign) on conflict (campaign_id) do nothing;
  select * into r from public.campaign_chats where campaign_id = p_campaign;
  return r;
end $f$;

create or replace function public.cx_gc_add(p_campaign uuid, p_role text, p_body text, p_image text default null) returns public.campaign_chat_messages
language plpgsql security definer set search_path = public as $f$
declare m public.campaign_chat_messages; uid uuid := auth.uid(); c record;
begin
  select * into c from public.campaigns where id = p_campaign;
  insert into public.campaign_chat_messages (campaign_id, sender_id, sender_role, sender_name, body, image_url)
  values (p_campaign, case when p_role = 'system' then null else uid end, p_role,
          case p_role when 'system' then 'Clipency' when 'admin' then 'Clipency team'
                      when 'client' then coalesce(nullif(btrim(c.brand_name), ''), public.cx_display_name(uid))
                      else public.cx_display_name(uid) end,
          coalesce(p_body, ''), p_image)
  returning * into m;
  if m.sender_id is not null then
    insert into public.campaign_chat_reads (campaign_id, user_id, seen_at) values (p_campaign, uid, m.created_at)
    on conflict (campaign_id, user_id) do update set seen_at = excluded.seen_at;
  end if;
  return m;
end $f$;

create or replace function public.cx_gc_summary(p_campaign uuid, p_role text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'campaign_id', c.id, 'title', c.title, 'status', c.status,
    'enabled', coalesce(r.enabled, false), 'paused', coalesce(r.paused, false),
    'ttl_hours', public.cx_gc_ttl_hours(), 'free', true,
    'role', p_role,
    'member_count', (select count(distinct x.u) from (
        select s.user_id u from public.clip_submissions s where s.campaign_id = c.id::text
        union select a.user_id from public.campaign_applications a where a.campaign_id = c.id and a.status = 'approved') x),
    'banned', case when p_role = 'admin' then coalesce((select jsonb_agg(jsonb_build_object('id', b.user_id, 'name', public.cx_display_name(b.user_id)))
                                                         from public.campaign_chat_bans b where b.campaign_id = c.id), '[]'::jsonb) end,
    'client_name', coalesce(nullif(btrim(c.brand_name), ''), public.cx_display_name(c.client_user_id)),
    'icon_url', c.icon_url)) ||
  jsonb_build_object(
    'last_message_at', lm.created_at,
    'last_preview', case when lm.body <> '' then left(lm.body, 100) when lm.image_url is not null then '[image]' else '' end,
    'last_sender', lm.sender_name,
    'unread', (select count(*) from public.campaign_chat_messages m
                where m.campaign_id = c.id and m.sender_role <> 'system' and m.sender_id is distinct from auth.uid()
                  and m.created_at > coalesce((select rd.seen_at from public.campaign_chat_reads rd where rd.campaign_id = c.id and rd.user_id = auth.uid()), '-infinity')))
  from public.campaigns c
  left join public.campaign_chats r on r.campaign_id = c.id
  left join lateral (select m.body, m.image_url, m.sender_name, m.created_at from public.campaign_chat_messages m
                      where m.campaign_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
  where c.id = p_campaign
$$;

-- ---------- RPCs ----------
create or replace function public.gc_list() returns jsonb
language plpgsql stable security definer set search_path = public as $f$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  return coalesce((
    select jsonb_agg(s order by s->>'last_message_at' desc nulls last)
      from (select public.cx_gc_summary(c.id, x.role) s
              from public.campaigns c cross join lateral (select public.cx_gc_role(c.id) role) x
             where x.role is not null and (x.role <> 'creator' or public.cx_gc_can_read(c.id))) q), '[]'::jsonb);
end $f$;

create or replace function public.gc_status(p_campaign_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $f$
declare r text := public.cx_gc_role(p_campaign_id);
begin
  if r is null then return jsonb_build_object('enabled', false, 'role', null); end if;
  return public.cx_gc_summary(p_campaign_id, r);
end $f$;

create or replace function public.gc_set_enabled(p_campaign_id uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare role text := public.cx_gc_role(p_campaign_id); r public.campaign_chats; turn_on boolean := coalesce(p_enabled, false);
begin
  if role is null or role not in ('client','admin') then raise exception 'Only the client can turn the group chat on or off'; end if;
  r := public.cx_gc_room(p_campaign_id);
  if r.enabled = turn_on then return jsonb_build_object('enabled', turn_on); end if;
  update public.campaign_chats set enabled = turn_on, enabled_at = now(), updated_at = now() where campaign_id = p_campaign_id;
  perform public.cx_gc_add(p_campaign_id, 'system', case when turn_on then 'The group chat is on. Everyone posting for this campaign can read it.'
                                                         else 'The group chat was turned off. Creators can no longer see it.' end);
  return jsonb_build_object('enabled', turn_on);
end $f$;

create or replace function public.gc_messages(p_campaign_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare role text := public.cx_gc_role(p_campaign_id); uid uuid := auth.uid();
begin
  if role is null then raise exception 'You are not part of this campaign'; end if;
  if not public.cx_gc_can_read(p_campaign_id) then raise exception 'The group chat for this campaign is off'; end if;
  insert into public.campaign_chat_reads (campaign_id, user_id, seen_at) values (p_campaign_id, uid, clock_timestamp())
  on conflict (campaign_id, user_id) do update set seen_at = clock_timestamp();
  return jsonb_build_object(
    'summary', public.cx_gc_summary(p_campaign_id, role),
    'messages', coalesce((select jsonb_agg(to_jsonb(m) || jsonb_build_object('mine', coalesce(m.sender_id = uid, false)) order by m.created_at, m.id)
                            from public.campaign_chat_messages m
                           where m.campaign_id = p_campaign_id and m.created_at > now() - make_interval(hours => public.cx_gc_ttl_hours())), '[]'::jsonb));
end $f$;

create or replace function public.gc_post(p_campaign_id uuid, p_body text default '', p_image_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare role text := public.cx_gc_role(p_campaign_id); r public.campaign_chats; body text := btrim(coalesce(p_body, '')); bad text;
begin
  if role is null then raise exception 'You are not part of this campaign'; end if;
  select * into r from public.campaign_chats where campaign_id = p_campaign_id;
  if not coalesce(r.enabled, false) then raise exception 'The group chat for this campaign is off'; end if;
  if r.paused and role <> 'admin' then raise exception 'Clipency has paused this chat for now'; end if;
  if length(body) > 2000 then raise exception 'Message is too long (2000 characters max)'; end if;
  bad := public.cx_gc_violation(body, role);
  if bad <> '' then raise exception 'Group chats can’t include %.', bad; end if;
  if not public.cx_chat_image_ok(p_image_url, 'appeal-attachments') then raise exception 'Images must be uploaded from the dashboard'; end if;
  if body = '' and p_image_url is null then raise exception 'Write a message or attach an image'; end if;
  -- a light flood guard: 20 messages a minute per person
  if role <> 'admin' and (select count(*) from public.campaign_chat_messages m where m.campaign_id = p_campaign_id and m.sender_id = auth.uid()
                            and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down a little: too many messages in a minute';
  end if;
  return to_jsonb(public.cx_gc_add(p_campaign_id, role, body, p_image_url)) || jsonb_build_object('mine', true);
end $f$;

-- ---- supervision (Clipency only) ----
create or replace function public.gc_delete_message(p_message_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $f$
begin
  if not public.cx_is_staff() then raise exception 'Only Clipency can delete messages'; end if;
  delete from public.campaign_chat_messages where id = p_message_id;
  return jsonb_build_object('ok', true);
end $f$;

create or replace function public.gc_set_paused(p_campaign_id uuid, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public as $f$
declare r public.campaign_chats; turn_on boolean := coalesce(p_paused, false);
begin
  if not public.cx_is_staff() then raise exception 'Only Clipency can pause a chat'; end if;
  r := public.cx_gc_room(p_campaign_id);
  if r.paused = turn_on then return jsonb_build_object('paused', turn_on); end if;
  update public.campaign_chats set paused = turn_on, updated_at = now() where campaign_id = p_campaign_id;
  perform public.cx_gc_add(p_campaign_id, 'system', case when turn_on then 'Clipency paused this chat. Only the Clipency team can post right now.'
                                                         else 'Clipency reopened this chat.' end);
  return jsonb_build_object('paused', turn_on);
end $f$;

create or replace function public.gc_ban(p_campaign_id uuid, p_user_id uuid, p_banned boolean) returns jsonb
language plpgsql security definer set search_path = public as $f$
begin
  if not public.cx_is_staff() then raise exception 'Only Clipency can remove people from a chat'; end if;
  if coalesce(p_banned, false) then
    if exists (select 1 from public.campaigns c where c.id = p_campaign_id and c.client_user_id = p_user_id)
       or exists (select 1 from public.campaign_clients cc where cc.campaign_id = p_campaign_id and cc.client_user_id = p_user_id) then
      raise exception 'The client can’t be removed from their own campaign chat';
    end if;
    insert into public.campaign_chat_bans (campaign_id, user_id, banned_by) values (p_campaign_id, p_user_id, auth.uid())
    on conflict do nothing;
    if found then
      perform public.cx_gc_add(p_campaign_id, 'system', public.cx_display_name(p_user_id) || ' was removed from this chat by Clipency.');
    end if;
  else
    delete from public.campaign_chat_bans where campaign_id = p_campaign_id and user_id = p_user_id;
  end if;
  return jsonb_build_object('ok', true);
end $f$;

-- ---------- scheduled work (039 schedules these) ----------
-- delete messages older than 12 hours; returns how many
create or replace function public.cx_gc_purge() returns int
language plpgsql security definer set search_path = public as $f$
declare n int;
begin
  delete from public.campaign_chat_messages where created_at < now() - make_interval(hours => public.cx_gc_ttl_hours());
  get diagnostics n = row_count;
  return n;
end $f$;

-- ---------- row-level security (reads only; Realtime uses these) ----------
alter table public.campaign_chats enable row level security;
alter table public.campaign_chat_messages enable row level security;
alter table public.campaign_chat_bans enable row level security;
alter table public.campaign_chat_reads enable row level security;
revoke all on public.campaign_chats, public.campaign_chat_messages, public.campaign_chat_bans, public.campaign_chat_reads from anon, authenticated;
grant select on public.campaign_chats, public.campaign_chat_messages to authenticated;

drop policy if exists campaign_chats_read on public.campaign_chats;
create policy campaign_chats_read on public.campaign_chats for select to authenticated using (public.cx_gc_role(campaign_id) is not null);
drop policy if exists campaign_chat_messages_read on public.campaign_chat_messages;
create policy campaign_chat_messages_read on public.campaign_chat_messages for select to authenticated using (public.cx_gc_can_read(campaign_id));

-- ---------- grants ----------
revoke all on function public.cx_gc_ttl_hours(), public.cx_gc_role(uuid), public.cx_gc_can_read(uuid),
  public.cx_gc_violation(text, text), public.cx_gc_room(uuid), public.cx_gc_add(uuid, text, text, text),
  public.cx_gc_summary(uuid, text), public.cx_gc_purge() from public, anon, authenticated;
grant execute on function public.cx_gc_role(uuid), public.cx_gc_can_read(uuid) to authenticated;   -- RLS policies call them
grant execute on function public.cx_gc_purge() to service_role;
revoke all on function public.gc_list(), public.gc_status(uuid), public.gc_set_enabled(uuid, boolean), public.gc_messages(uuid),
  public.gc_post(uuid, text, text), public.gc_delete_message(uuid), public.gc_set_paused(uuid, boolean), public.gc_ban(uuid, uuid, boolean) from public, anon;
grant execute on function public.gc_list(), public.gc_status(uuid), public.gc_set_enabled(uuid, boolean), public.gc_messages(uuid),
  public.gc_post(uuid, text, text), public.gc_delete_message(uuid), public.gc_set_paused(uuid, boolean), public.gc_ban(uuid, uuid, boolean) to authenticated;

commit;
