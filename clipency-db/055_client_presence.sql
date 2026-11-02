-- 055: see when clients are on their dashboard, and get told when they arrive.
--
-- The client portal (js/live.js) calls client_ping() when a page opens and every
-- minute while it is open and in front. A "visit" runs until 15 minutes without a
-- ping; the first ping of a new visit sends a Telegram message to the team chat
-- (Outreach topic, same bot as new leads). Console > Clients shows who is online now,
-- the page they are on, and how much they used the dashboard in the last 7 days.
--
-- Staff and admins previewing the portal are never counted. New table and functions
-- only; nothing existing is changed.

begin;

create table public.client_visits (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  started_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_path    text,
  pings        int not null default 1
);
create index client_visits_user_seen on public.client_visits(user_id, last_seen_at desc);
alter table public.client_visits enable row level security;
revoke all on public.client_visits from anon, authenticated;

create or replace function public.client_ping(p_path text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v public.client_visits; who record; path text := left(nullif(btrim(coalesce(p_path, '')), ''), 200);
begin
  if uid is null or not public.cx_is_client() or public.cx_is_staff() then return; end if;
  select * into v from public.client_visits
   where user_id = uid and last_seen_at > now() - interval '15 minutes'
   order by last_seen_at desc limit 1 for update;
  if found then
    if v.last_seen_at < now() - interval '20 seconds' or path is distinct from v.last_path then
      update public.client_visits set last_seen_at = now(), last_path = coalesce(path, last_path), pings = pings + 1 where id = v.id;
    end if;
    return;
  end if;
  insert into public.client_visits(user_id, last_path) values (uid, path);
  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)) as name, p.company_name as company, p.email
    into who from public.profiles p where p.id = uid;
  perform public.tg_send('thread_outreach',
    '👀 <b>Client on the dashboard</b>' || chr(10) ||
    '<b>Client:</b> ' || replace(replace(coalesce(who.name, '—'), '<', ''), '>', '') ||
      coalesce(' (' || replace(replace(nullif(who.company, ''), '<', ''), '>', '') || ')', '') || chr(10) ||
    '<b>Email:</b> ' || coalesce(who.email, '—') || chr(10) ||
    '<b>Page:</b> ' || replace(replace(coalesce(path, '/'), '<', ''), '>', ''));
end $$;
revoke execute on function public.client_ping(text) from public, anon;
grant  execute on function public.client_ping(text) to authenticated;

-- Console: one row per client account that has ever visited.
create or replace function public.admin_client_presence()
returns table (user_id uuid, online boolean, visit_started_at timestamptz, last_seen_at timestamptz,
               last_path text, visits_7d int, minutes_7d int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select v.user_id,
         max(v.last_seen_at) > now() - interval '2 minutes',
         (array_agg(v.started_at order by v.last_seen_at desc))[1],
         max(v.last_seen_at),
         (array_agg(v.last_path order by v.last_seen_at desc))[1],
         (count(*) filter (where v.started_at > now() - interval '7 days'))::int,
         (coalesce(sum(extract(epoch from v.last_seen_at - v.started_at)) filter (where v.started_at > now() - interval '7 days'), 0) / 60)::int
    from public.client_visits v
   group by v.user_id;
end $$;
revoke execute on function public.admin_client_presence() from public, anon;
grant  execute on function public.admin_client_presence() to authenticated;

commit;
