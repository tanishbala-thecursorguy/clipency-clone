-- 012 · Give a new non-USD campaign the day's rate.
--
-- cs_calc_earning stamps earning_amount_native as usd * coalesce(fx_rate_per_usd, 1).
-- Nothing wrote that column, so an INR campaign would have credited a creator
-- 6 rupees for six dollars. This fills it in at creation, from cx_fx_rates.
--
-- Deliberately INSERT only, and only when the column was left empty or at 1:
--   - a rate already chosen by hand is never overwritten
--   - an existing campaign's rate never moves, so two clips approved on the
--     same campaign are never stamped differently by a market that drifted
--   - already-approved clips are untouched by definition: their rate is
--     stamped on the clip row, not read back from the campaign
create or replace function public.cx_campaign_default_fx()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(upper(new.currency), 'USD') = 'USD' then
    new.fx_rate_per_usd := 1;
    new.fx_rate_updated_at := now();
    return new;
  end if;

  if new.fx_rate_per_usd is null or new.fx_rate_per_usd = 1 then
    new.fx_rate_per_usd := public.cx_fx_rate(new.currency);
    new.fx_rate_updated_at := now();
  end if;

  return new;
end $$;

comment on function public.cx_campaign_default_fx() is
  'Stamps a new campaign with the day''s rate for its currency. Insert only - an existing campaign''s fx_rate_per_usd is never moved.';

drop trigger if exists cx_campaign_default_fx_ins on public.campaigns;
create trigger cx_campaign_default_fx_ins
  before insert on public.campaigns
  for each row execute function public.cx_campaign_default_fx();
