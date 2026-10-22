-- 019 · Change the currency of a campaign that already has paid clips.
--
-- Until now the currency picker was locked once a clip was approved
-- (cx_lock_campaign_currency), because every approved clip is stamped in the
-- campaign's currency. Ayush needs to be able to switch it.
--
-- admin_convert_campaign_currency() restates the whole campaign at the day's
-- rate, in one transaction:
--   campaign  budget, rate_per_video, rpm, max_pay_per_clip,
--             max_pay_per_creator, platform_fee_amount, fx_rate_per_usd
--   secrets   client_rate_per_video, client_rpm (the brand side)
--   clips     earning_amount_native, rate_per_video_at_approval,
--             rate_per_million_at_approval, fx_rate_per_usd_at_approval
--   budget_used follows from the clips (sync_campaign_stats_on_submission)
--
-- What does NOT move: approved_amount / earning_amount, the USD every creator
-- has been credited and is paid out in. The function checks that the sum of
-- approved_amount on the campaign is identical before and after, and rolls
-- the whole conversion back if it is not by even a cent. Each clip's new
-- native figure is derived from that USD amount, so re-settling a creator
-- later lands on the same dollars.
--
-- Percent fees, view caps and video counts are unit-free and do not change.

-- the lock steps aside only for this function
create or replace function public.cx_lock_campaign_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare v_approved int;
begin
  if new.currency is not distinct from old.currency then return new; end if;
  if coalesce(current_setting('cx.currency_convert', true), '0') = '1' then return new; end if;

  select count(*) into v_approved
  from public.clip_submissions
  where campaign_id = old.id::text and status = 'approved';

  if v_approved > 0 then
    raise exception
      'Cannot change this campaign''s currency from % to % directly: % clip(s) are already approved. Use admin_convert_campaign_currency(), which restates every amount.',
      old.currency, new.currency, v_approved
      using errcode = '22023';
  end if;

  return new;
end
$function$;

create or replace function public.admin_convert_campaign_currency(p_campaign uuid, p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c          public.campaigns%rowtype;
  v_new      text := upper(btrim(coalesce(p_currency, '')));
  v_old      text;
  f_old      numeric;
  f_new      numeric;
  k          numeric;
  usd_before numeric;
  usd_after  numeric;
  n_clips    int;
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'Campaign not found'; end if;

  if not exists (select 1 from public.cx_fx_rates where currency = v_new) then
    raise exception 'Unsupported currency "%"', v_new using errcode = '22023';
  end if;

  v_old := upper(coalesce(c.currency, 'USD'));
  if v_new = v_old then
    return jsonb_build_object('converted', false, 'currency', v_old);
  end if;

  f_old := greatest(coalesce(c.fx_rate_per_usd, 1), 0.000001);
  f_new := case when v_new = 'USD' then 1 else public.cx_fx_rate(v_new) end;
  k     := f_new / f_old;

  select coalesce(sum(approved_amount), 0), count(*)
    into usd_before, n_clips
  from public.clip_submissions where campaign_id = p_campaign::text;

  perform set_config('cx.settling', '1', true);            -- cs_calc_earning / settle stand down
  perform set_config('clipency.trusted_write', '1', true); -- cs_freeze_metrics lets the write through
  perform set_config('cx.currency_convert', '1', true);    -- the currency lock lets it through

  -- 1. clips: native restated from the USD they were credited
  update public.clip_submissions set
    earning_amount_native = case
        when earning_amount_native is null then null
        when coalesce(approved_amount, 0) > 0 then round(approved_amount * f_new, 2)
        else round(earning_amount_native * k, 2) end,
    rate_per_video_at_approval   = round(rate_per_video_at_approval * k, 2),
    rate_per_million_at_approval = round(rate_per_million_at_approval * k, 2),
    fx_rate_per_usd_at_approval  = case when fx_rate_per_usd_at_approval is null then null else f_new end
  where campaign_id = p_campaign::text;

  -- 2. the brand side, before the campaign row, so the brand >= creator
  --    check sees both rates in the new currency
  update public.campaign_secrets set
    client_rate_per_video = round(client_rate_per_video * k, 2),
    client_rpm            = round(client_rpm * k, 2),
    updated_at            = now()
  where campaign_id = p_campaign;

  -- 3. the campaign
  update public.campaigns set
    currency            = v_new,
    fx_rate_per_usd     = f_new,
    fx_rate_updated_at  = now(),
    budget              = round(coalesce(budget, 0) * k, 2),
    rate_per_video      = round(coalesce(rate_per_video, 0) * k, 2),
    rpm                 = round(coalesce(rpm, 0) * k, 2),
    max_pay_per_clip    = round(max_pay_per_clip * k, 2),
    max_pay_per_creator = round(max_pay_per_creator * k, 2),
    platform_fee_amount = round(platform_fee_amount * k, 2),
    updated_at          = now()
  where id = p_campaign;

  perform set_config('cx.currency_convert', '0', true);
  perform set_config('clipency.trusted_write', '0', true);
  perform set_config('cx.settling', '0', true);

  select coalesce(sum(approved_amount), 0) into usd_after
  from public.clip_submissions where campaign_id = p_campaign::text;
  if usd_after is distinct from usd_before then
    raise exception 'Conversion would have moved creator earnings (% USD before, % after). Nothing was changed.',
      usd_before, usd_after;
  end if;

  select * into c from public.campaigns where id = p_campaign;
  return jsonb_build_object(
    'converted', true, 'from', v_old, 'to', v_new,
    'fx_from', f_old, 'fx_to', f_new, 'factor', round(k, 6),
    'clips', n_clips, 'creator_usd', usd_after,
    'budget', c.budget, 'budget_used', c.budget_used,
    'rate_per_video', c.rate_per_video, 'rpm', c.rpm);
end $$;

revoke execute on function public.admin_convert_campaign_currency(uuid, text) from public, anon;
grant execute on function public.admin_convert_campaign_currency(uuid, text) to authenticated;

comment on function public.admin_convert_campaign_currency(uuid, text) is
  'Staff only. Restates a campaign, its brand rates and its clips in another currency at the day''s rate. Creator USD (approved_amount) is guaranteed unchanged.';
