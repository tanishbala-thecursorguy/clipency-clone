-- 009 · Display-currency preference for a creator.
--
-- This is a view setting and nothing else: money is stored in USD, approved
-- clips are stamped in the campaign's currency at approval, and payouts settle
-- in USD. Nothing in the settlement path reads this column. It exists so the
-- creator's own pick follows them to another device instead of living only in
-- that browser's localStorage.
--
-- Null means "no pick yet", which is what lets the dashboard fall back to the
-- currency of the campaigns the creator is actually on.
alter table public.profiles
  add column if not exists preferred_currency text;

alter table public.profiles
  drop constraint if exists profiles_preferred_currency_chk;

-- Only the codes the dashboard can render. An unknown code would silently fall
-- back to USD on screen, which reads as the setting being ignored.
alter table public.profiles
  add constraint profiles_preferred_currency_chk
  check (preferred_currency is null
         or preferred_currency in ('USD','INR','EUR','GBP','JPY','AUD','CAD'));

comment on column public.profiles.preferred_currency is
  'Creator display-currency override for the clipper dashboard. Display only - payouts settle in USD and approved clips keep their stamped fx_rate_per_usd_at_approval.';
