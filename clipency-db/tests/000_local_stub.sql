-- ============================================================
-- LOCAL TEST STUB. Never run this on Supabase.
-- A minimal stand-in for the parts of the live Clipency database that
-- migrations 035+ depend on, so they can be applied and tested on a plain
-- local Postgres. Shapes follow the live schema as reconstructed from
-- clipency-db/001..034 (base tables were created in the Supabase UI).
-- ============================================================

-- Supabase roles
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- auth: users + auth.uid() read from the request claims, like PostgREST sets them
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
grant usage on schema auth to anon, authenticated, service_role;

-- extension stand-ins: pg_cron, pg_net, storage, realtime publication
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(p_name text, p_schedule text, p_command text) returns int language plpgsql as
$$ declare i int; begin insert into cron.job(jobname, schedule, command) values (p_name, p_schedule, p_command)
   on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into i; return i; end $$;
create or replace function cron.unschedule(p_id int) returns boolean language sql as $$ delete from cron.job where jobid = p_id returning true $$;
create schema if not exists net;
create table if not exists net.calls (id bigserial primary key, url text, body jsonb, at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.calls(url, body) values (url, body) returning id $$;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);

-- public: the live tables, only the columns the new features read or write
create table public.profiles (
  id uuid primary key, email text, role text default 'clipper', username text, full_name text, display_name text,
  client_access boolean default false, company_name text, created_at timestamptz default now());
create table public.campaigns (
  id uuid primary key default gen_random_uuid(), title text, brand_name text, icon_url text, asset_url text, genre text, category text,
  platform text, campaign_type text, status text default 'active', is_private boolean default false, client_user_id uuid, payout_model text default 'per_view',
  currency text default 'USD', rpm numeric default 0, rate_per_video numeric default 0,
  client_review boolean not null default true, client_review_hours integer not null default 48,
  created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.campaigns add constraint campaigns_client_review_hours_chk check (client_review_hours between 1 and 168);
create table public.campaign_clients (campaign_id uuid, client_user_id uuid, primary key (campaign_id, client_user_id));
create table public.connected_accounts (
  id uuid primary key default gen_random_uuid(), user_id uuid, platform text, handle text, username text, profile_url text,
  status text default 'pending', is_verified boolean default false, verified_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.campaign_applications (
  id uuid primary key default gen_random_uuid(), campaign_id uuid, user_id uuid, connected_account_id uuid, status text default 'pending',
  created_at timestamptz default now());
create table public.clip_submissions (
  id uuid primary key default gen_random_uuid(), user_id uuid, connected_account_id uuid, campaign_id text, campaign_title text,
  handle text, platform text, clip_url text, clip_key text, status text default 'pending', earning_status text,
  rejection_reason text, review_due_at timestamptz, review_source text, reviewed_by uuid, reviewed_at timestamptz,
  views_count bigint default 0, approved_amount numeric default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.client_wallet_ledger (
  id uuid primary key default gen_random_uuid(), client_user_id uuid, kind text, amount numeric, campaign_id uuid, note text,
  created_by uuid, created_at timestamptz default now());

-- live helpers: same logic as the live bodies (read from the project on 2026-10-22)
create table public.admin_users (id uuid primary key default gen_random_uuid(), user_id uuid, email text, created_at timestamptz default now());
create table public.reviewer_users (id uuid primary key default gen_random_uuid(), user_id uuid, email text, created_at timestamptz default now());
create or replace function public.cx_is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and exists (select 1 from admin_users where user_id = auth.uid()) $$;
create or replace function public.cx_is_staff() returns boolean language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and (public.cx_is_admin() or exists (select 1 from reviewer_users where user_id = auth.uid())) $$;
create or replace function public.cx_is_client() returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles p where p.id = auth.uid() and (p.client_access = true or lower(coalesce(p.role,'')) = 'client')) $$;
create or replace function public.cx_is_campaign_client(p_campaign uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from campaigns c where c.id = p_campaign and c.client_user_id = auth.uid())
       or exists (select 1 from campaign_clients cc where cc.campaign_id = p_campaign and cc.client_user_id = auth.uid()) $$;
create or replace function public.cx_is_approved_for_campaign(p_campaign uuid) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from campaign_applications a where a.campaign_id = p_campaign and a.user_id = auth.uid() and a.status = 'approved') $$;
create or replace function public.cx_client_review_on(p_campaign text) returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from campaigns c where c.id::text = p_campaign and c.client_review
                   and (c.client_user_id is not null or exists (select 1 from campaign_clients cc where cc.campaign_id = c.id))) $$;
-- the live duplicate guard's key function (022), same rules
create or replace function public.cx_clip_key(p_url text) returns text language plpgsql immutable as $$
declare u text := lower(btrim(coalesce(p_url, ''))); m text[];
begin
  if u = '' then return null; end if;
  m := regexp_match(u, 'instagram\.com/(?:[^/]+/)?(?:reels?|p|tv)/([a-z0-9_-]+)'); if m is not null then return 'ig:' || m[1]; end if;
  m := regexp_match(u, '(?:youtu\.be/|youtube\.com/(?:shorts/|watch\?v=|embed/))([a-z0-9_-]{11})'); if m is not null then return 'yt:' || m[1]; end if;
  m := regexp_match(u, 'tiktok\.com/@[^/]+/video/([0-9]+)'); if m is not null then return 'tt:' || m[1]; end if;
  return 'url:' || regexp_replace(regexp_replace(u, '^https?://(www\.)?', ''), '[?#].*$', '');
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant select on all tables in schema public to authenticated, service_role;

-- live wallet balance (created in the Supabase UI; 016/017 call it): what's left = sum of the ledger
create or replace function public.client_wallet_balance(p_client uuid) returns numeric language sql stable security definer set search_path = public as
$$ select coalesce(sum(amount), 0) from client_wallet_ledger where client_user_id = p_client $$;
grant usage on schema storage to authenticated, service_role;   -- as on Supabase
-- the live review-deadline stamp (insert only), same logic
create or replace function public.cx_stamp_review_due() returns trigger language plpgsql security definer set search_path = public as $$
declare h int; begin
  new.review_source := null; new.review_due_at := null;
  if new.status = 'pending' and public.cx_client_review_on(new.campaign_id) then
    select client_review_hours into h from public.campaigns where id::text = new.campaign_id;
    new.review_due_at := now() + make_interval(hours => coalesce(h, 48));
  end if; return new; end $$;
create trigger trg_cx_stamp_review_due before insert on public.clip_submissions for each row execute function public.cx_stamp_review_due();
