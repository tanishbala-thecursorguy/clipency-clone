-- 044: Promotions. Marketing emails that an admin approves in the console
-- (Promotions page) before anything is sent.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-29 with the owner's approval.
--
-- New objects only: three new tables and new functions. No existing table,
-- row or function is changed.
--
--   promo_emails        one row per email (draft -> approved -> sending -> sent, or rejected)
--   promo_sends         one row per recipient; unique (promo, email) so nobody gets it twice
--   promo_unsubscribes  addresses that opted out; never queued again
--
-- Flow: a draft is written (weekly article: by the Thursday drafting task;
-- one-offs: by hand). An admin approves it in the console (promo_approve),
-- which queues the audience. The promo-emails edge function, kicked every
-- 2 minutes by pg_cron, sends what is due in batches through Resend, rotating
-- the From address across the team mailboxes, and reports back (promo_mark).

begin;

create table public.promo_emails (
  id           bigserial primary key,
  kind         text not null check (kind in ('ugc_recruit', 'weekly_article', 'one_off')),
  audience     text not null check (audience in ('non_clients', 'list')),
  subject      text not null,
  html         text not null,
  text_body    text not null,
  status       text not null default 'draft' check (status in ('draft', 'approved', 'sending', 'sent', 'rejected')),
  send_at      timestamptz,
  note         text,
  approved_by  uuid,
  approved_at  timestamptz,
  queued       int not null default 0,
  sent         int not null default 0,
  failed       int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.promo_sends (
  id           bigserial primary key,
  promo_id     bigint not null references public.promo_emails(id) on delete cascade,
  user_id      uuid,
  email        text not null,
  first_name   text,
  from_email   text not null,
  token        uuid not null default gen_random_uuid(),
  status       text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  error        text,
  provider_id  text,
  sent_at      timestamptz,
  unique (promo_id, email)
);
create index promo_sends_queued on public.promo_sends (promo_id) where status = 'queued';
create unique index promo_sends_token on public.promo_sends (token);

create table public.promo_unsubscribes (
  email       text primary key,
  source      text,
  created_at  timestamptz not null default now()
);

alter table public.promo_emails       enable row level security;
alter table public.promo_sends        enable row level security;
alter table public.promo_unsubscribes enable row level security;
create policy promo_emails_staff_read on public.promo_emails for select to authenticated using (public.cx_is_staff());
create policy promo_sends_staff_read  on public.promo_sends  for select to authenticated using (public.cx_is_staff());
create policy promo_unsub_staff_read  on public.promo_unsubscribes for select to authenticated using (public.cx_is_staff());

-- The team mailboxes the From address rotates through; replies land in each.
create or replace function public.promo_senders()
returns text[] language sql immutable as $$
  select array['jake@clipency.in', 'ayush@clipency.in', 'tanish@clipency.in', 'hello@clipency.in', 'contact@clipency.in']
$$;

-- Queue a promo's audience. 'list' promos are queued by the caller with
-- promo_queue_list; 'non_clients' = every confirmed account that is not a client.
create or replace function public.promo_queue(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare a text; n int;
begin
  select audience into a from promo_emails where id = p_id;
  if a = 'non_clients' then
    insert into promo_sends (promo_id, user_id, email, first_name, from_email)
    select p_id, u.id, lower(u.email),
           nullif(split_part(coalesce(nullif(p.first_name, ''), nullif(p.display_name, ''), p.full_name, ''), ' ', 1), ''),
           (promo_senders())[1 + (row_number() over (order by u.created_at))::int % 5]
    from auth.users u join profiles p on p.id = u.id
    where u.email_confirmed_at is not null and u.email like '%@%'
      and coalesce(p.role, '') <> 'client'
      and not exists (select 1 from promo_unsubscribes x where x.email = lower(u.email))
    on conflict (promo_id, email) do nothing;
  end if;
  select count(*) into n from promo_sends where promo_id = p_id;
  update promo_emails set queued = n, updated_at = now() where id = p_id;
  return n;
end $$;

-- Queue an explicit list: [{"email": "...", "first_name": "..."}, ...]
create or replace function public.promo_queue_list(p_id bigint, p_list jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into promo_sends (promo_id, email, first_name, from_email)
  select p_id, lower(e->>'email'), nullif(e->>'first_name', ''),
         (promo_senders())[1 + (row_number() over (order by lower(e->>'email')))::int % 5]
  from jsonb_array_elements(p_list) e
  where (e->>'email') like '%@%'
    and not exists (select 1 from promo_unsubscribes x where x.email = lower(e->>'email'))
  on conflict (promo_id, email) do nothing;
  select count(*) into n from promo_sends where promo_id = p_id;
  update promo_emails set queued = n, updated_at = now() where id = p_id;
  return n;
end $$;

-- Console: approve (queues the audience; sends at send_at, or now if that has passed).
create or replace function public.promo_approve(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.cx_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update promo_emails set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         send_at = coalesce(send_at, now()), updated_at = now()
   where id = p_id and status = 'draft';
  if not found then raise exception 'Only drafts can be approved.'; end if;
  n := promo_queue(p_id);
  return n;
end $$;

create or replace function public.promo_reject(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cx_is_admin() then raise exception 'Admins only.' using errcode = '42501'; end if;
  update promo_emails set status = 'rejected', note = coalesce(p_note, note), updated_at = now()
   where id = p_id and status = 'draft';
  if not found then raise exception 'Only drafts can be rejected.'; end if;
end $$;

-- Sender: the next due batch. Unsubscribed addresses are dropped here too, in
-- case they opted out after being queued.
create or replace function public.promo_batch(p_limit int default 90)
returns table (id bigint, promo_id bigint, email text, first_name text, from_email text, token uuid,
               subject text, html text, text_body text)
language plpgsql security definer set search_path = public as $$
begin
  delete from promo_sends s using promo_unsubscribes x where s.status = 'queued' and x.email = s.email;
  update promo_emails e set status = 'sending', updated_at = now()
   where e.status = 'approved' and e.send_at <= now();
  return query
    select s.id, s.promo_id, s.email, s.first_name, s.from_email, s.token, e.subject, e.html, e.text_body
    from promo_sends s join promo_emails e on e.id = s.promo_id
    where s.status = 'queued' and e.status = 'sending'
    order by s.id limit p_limit;
end $$;

create or replace function public.promo_mark(p_id bigint, p_ok boolean, p_provider_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare pid bigint;
begin
  update promo_sends set status = case when p_ok then 'sent' else 'failed' end,
         provider_id = p_provider_id, error = p_error, sent_at = case when p_ok then now() end
   where id = p_id returning promo_id into pid;
  update promo_emails e set
    sent   = (select count(*) from promo_sends where promo_id = pid and status = 'sent'),
    failed = (select count(*) from promo_sends where promo_id = pid and status = 'failed'),
    status = case when exists (select 1 from promo_sends where promo_id = pid and status = 'queued') then e.status else 'sent' end,
    updated_at = now()
   where e.id = pid;
end $$;

create or replace function public.promo_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare em text;
begin
  select email into em from promo_sends where token = p_token;
  if em is null then return null; end if;
  insert into promo_unsubscribes (email, source) values (em, 'link') on conflict do nothing;
  return em;
end $$;

-- pg_cron kick, same pattern as cx_client_email_kick; only calls out when something is due.
create or replace function public.promo_kick()
returns bigint language plpgsql security definer set search_path = public, extensions, vault as $$
declare key text; req bigint;
begin
  if not exists (select 1 from promo_sends s join promo_emails e on e.id = s.promo_id
                 where s.status = 'queued' and e.status in ('approved', 'sending') and e.send_at <= now()) then
    return null;
  end if;
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'promo_kick: service_role_key missing'; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/promo-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := jsonb_build_object('mode', 'send'),
    timeout_milliseconds := 60000) into req;
  return req;
end $$;

-- Internal functions: only the owner (cron, edge function via service role).
revoke execute on function public.promo_queue(bigint)                    from public, anon, authenticated;
revoke execute on function public.promo_queue_list(bigint, jsonb)        from public, anon, authenticated;
revoke execute on function public.promo_batch(int)                       from public, anon, authenticated;
revoke execute on function public.promo_mark(bigint, boolean, text, text) from public, anon, authenticated;
revoke execute on function public.promo_unsubscribe(uuid)                from public, anon, authenticated;
revoke execute on function public.promo_kick()                           from public, anon, authenticated;
-- Console: signed-in callers; the functions check cx_is_admin() themselves.
revoke execute on function public.promo_approve(bigint)       from public, anon;
revoke execute on function public.promo_reject(bigint, text)  from public, anon;
grant  execute on function public.promo_approve(bigint)       to authenticated;
grant  execute on function public.promo_reject(bigint, text)  to authenticated;

select cron.schedule('cx_promo_emails', '*/2 * * * *', 'select public.promo_kick();');

commit;
