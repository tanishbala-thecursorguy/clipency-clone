-- 010 · Live exchange rates, dated.
--
-- Two places needed a rate and neither had one. The clipper dashboard was
-- converting at literals last touched years ago (INR at 83 against a real
-- 95-and-change, so a rupee figure read 13% low), and campaigns.fx_rate_per_usd
-- - the number that stamps earning_amount_native when a clip is approved - was
-- read by cs_calc_earning and written by nothing at all. An INR campaign would
-- have credited a creator 6 rupees for six dollars.
--
-- This table is the server-side answer. The dashboard also reads the same
-- source directly for display; this one exists because stamping happens in the
-- database, where a browser's fetch cannot help.
--
-- Source: European Central Bank reference rates, through frankfurter.dev. No
-- key, one published set per working day, and every row carries the date it is
-- for, so a stale rate is visible rather than silent.

create table if not exists public.cx_fx_rates (
  currency      text primary key,
  rate_per_usd  numeric not null check (rate_per_usd > 0),
  as_of         date    not null,
  source        text    not null default 'ecb/frankfurter',
  fetched_at    timestamptz not null default now()
);

comment on table public.cx_fx_rates is
  'One row per currency: how many units one USD buys, and the date that rate is for. Read by cx_fx_rate() when a campaign is created in a non-USD currency. Never rewrites money already stamped on an approved clip.';

alter table public.cx_fx_rates enable row level security;

-- Rates are not secret, but nothing in the app needs to read them from the
-- client either: the dashboard calls the API itself. Staff can look.
drop policy if exists cx_fx_rates_staff_read on public.cx_fx_rates;
create policy cx_fx_rates_staff_read on public.cx_fx_rates
  for select to authenticated
  using (public.cx_is_staff());

-- Seed, so the table is never empty on a cold start. ECB reference rates for
-- 2026-09-10. The refresher overwrites these on its first successful run.
insert into public.cx_fx_rates (currency, rate_per_usd, as_of, source) values
  ('USD', 1,       '2026-09-10', 'base'),
  ('INR', 95.44,   '2026-09-10', 'ecb/frankfurter'),
  ('EUR', 0.86088, '2026-09-10', 'ecb/frankfurter'),
  ('GBP', 0.73963, '2026-09-10', 'ecb/frankfurter'),
  ('JPY', 154.18,  '2026-09-10', 'ecb/frankfurter'),
  ('AUD', 1.3918,  '2026-09-10', 'ecb/frankfurter'),
  ('CAD', 1.3816,  '2026-09-10', 'ecb/frankfurter')
on conflict (currency) do nothing;

-- The reader. Falls back to 1 rather than 0 or null: a missing rate must
-- degrade to "USD-equivalent", never to free work or to a divide by zero.
create or replace function public.cx_fx_rate(p_currency text)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select r.rate_per_usd from public.cx_fx_rates r
      where r.currency = upper(coalesce(p_currency,'USD'))),
    1)::numeric;
$$;

comment on function public.cx_fx_rate(text) is
  'Units of the given currency per USD, from cx_fx_rates. Falls back to 1 when unknown.';

revoke all on function public.cx_fx_rate(text) from public, anon, authenticated;
