-- 017 · Multi-currency campaigns, end to end.
--
-- Ayush (23 Sep 2026): a campaign is priced in its own currency (Rs 250 per
-- video, or $2.50 per video). The client and creator dashboards default to
-- showing every campaign in its own currency, a mix, and a currency picker
-- converts everything to one currency on request.
--
-- What already existed and is kept:
--   * campaigns.currency + campaigns.fx_rate_per_usd (frozen at creation)
--   * budget, budget_used, rate_per_video, rpm, client_* rates: all NATIVE
--   * clip_submissions.earning_amount_native (native) and approved_amount (USD),
--     stamped at approval with fx_rate_per_usd_at_approval
--   * payouts settle in USD; the client wallet ledger is USD
--
-- What this adds or fixes:
--   1. cx_fx_rates_public(): the day's rates for any signed-in user, so both
--      dashboards convert with the same numbers the database stamps with.
--   2. Currency is validated (must be a currency we have a rate for) and
--      normalised to upper case. Changing it on a campaign with no approved
--      clips re-prices fx_rate_per_usd to that day's rate. Before, only INSERT
--      set the rate, so switching a draft from USD to INR left fx at 1 and
--      would have stamped Rs 250 as $250.
--   3. profiles.preferred_currency accepts 'DEFAULT' (each campaign in its own
--      currency), the new default view.
--   4. client_dashboard_data() also returns spent_native / remaining_native per
--      campaign, currency per clip, and the day's rates.
--   5. admin_allocate_budget / admin_deallocate_budget: the wallet is USD and a
--      budget is native. They added the raw number to both, so moving $100 onto
--      an INR campaign would have reserved Rs 100. p_amount is now USD (the
--      wallet's unit) and is converted at the campaign's own fx rate. USD
--      campaigns (fx = 1) behave exactly as before.

-- 1 -------------------------------------------------------------------------
create or replace function public.cx_fx_rates_public()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'rates', coalesce(jsonb_object_agg(r.currency, r.rate_per_usd), '{}'::jsonb),
    'as_of', max(r.as_of))
  from public.cx_fx_rates r;
$$;
revoke execute on function public.cx_fx_rates_public() from public, anon;
grant execute on function public.cx_fx_rates_public() to authenticated;

-- 2 -------------------------------------------------------------------------
create or replace function public.cx_campaign_default_fx()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), 'USD'));

  if not exists (select 1 from public.cx_fx_rates r where r.currency = new.currency) then
    raise exception 'Unsupported currency "%". Use one of: %', new.currency,
      (select string_agg(currency, ', ' order by currency) from public.cx_fx_rates)
      using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency then
    return new;
  end if;

  if new.currency = 'USD' then
    new.fx_rate_per_usd := 1;
    new.fx_rate_updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- a rate chosen by hand is kept; empty or 1 means "not chosen"
    if new.fx_rate_per_usd is null or new.fx_rate_per_usd = 1 then
      new.fx_rate_per_usd := public.cx_fx_rate(new.currency);
      new.fx_rate_updated_at := now();
    end if;
  else
    -- Currency changed. trg_cx_lock_campaign_currency (runs after this one)
    -- refuses the change if any clip is already approved, so nothing stamped
    -- can move. Re-price unless the caller set a new rate in the same write.
    if new.fx_rate_per_usd is not distinct from old.fx_rate_per_usd
       or new.fx_rate_per_usd is null or new.fx_rate_per_usd = 1 then
      new.fx_rate_per_usd := public.cx_fx_rate(new.currency);
      new.fx_rate_updated_at := now();
    end if;
  end if;

  return new;
end $$;

drop trigger if exists cx_campaign_default_fx_ins on public.campaigns;
drop trigger if exists cx_campaign_default_fx_trg on public.campaigns;
-- Name sorts before trg_cx_lock_campaign_currency, so the lock sees the
-- normalised code.
create trigger cx_campaign_default_fx_trg
  before insert or update of currency on public.campaigns
  for each row execute function public.cx_campaign_default_fx();

comment on function public.cx_campaign_default_fx() is
  'Validates and upper-cases campaigns.currency; stamps fx_rate_per_usd with the day''s rate on insert and when the currency of a campaign with no approved clips is changed.';

-- 3 -------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_preferred_currency_chk;
alter table public.profiles
  add constraint profiles_preferred_currency_chk
  check (preferred_currency is null
         or preferred_currency in ('DEFAULT','USD','INR','EUR','GBP','JPY','AUD','CAD'));

-- 5 -------------------------------------------------------------------------
create or replace function public.admin_allocate_budget(p_campaign uuid, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usd numeric := round(p_amount, 2);
  v_client uuid; v_bal numeric; v_budget numeric; v_fx numeric; v_native numeric; v_ccy text;
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_usd is null or v_usd <= 0 then raise exception 'Allocation must be greater than zero'; end if;

  select client_user_id, coalesce(budget,0), greatest(coalesce(fx_rate_per_usd,1),0.000001), coalesce(currency,'USD')
    into v_client, v_budget, v_fx, v_ccy
  from public.campaigns where id = p_campaign for update;

  if v_client is null then
    raise exception 'That campaign is not connected to a client account yet';
  end if;

  v_bal := public.client_wallet_balance(v_client);
  if v_bal < v_usd then
    raise exception 'Not enough balance: % available, % requested', v_bal, v_usd;
  end if;

  v_native := round(v_usd * v_fx, 2);

  insert into public.client_wallet_ledger(client_user_id, kind, amount, campaign_id, note, created_by)
  values (v_client, 'allocation', -v_usd, p_campaign,
          coalesce(p_note, 'Allocated to campaign'
                   || case when v_ccy <> 'USD' then ' (' || v_native || ' ' || v_ccy || ')' else '' end),
          auth.uid());

  update public.campaigns set budget = v_budget + v_native, updated_at = now()
  where id = p_campaign;

  return jsonb_build_object('balance', public.client_wallet_balance(v_client),
                            'budget', v_budget + v_native,
                            'currency', v_ccy,
                            'allocated_usd', v_usd,
                            'allocated_native', v_native);
end $function$;

create or replace function public.admin_deallocate_budget(p_campaign uuid, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_usd numeric := round(p_amount, 2);
  v_client uuid; v_budget numeric; v_used numeric; v_fee numeric; v_floor numeric; v_free numeric;
  v_fx numeric; v_native numeric; v_free_usd numeric;
  c public.campaigns%rowtype;
begin
  if not public.cx_is_staff() then raise exception 'forbidden' using errcode='42501'; end if;
  if v_usd is null or v_usd <= 0 then raise exception 'Amount must be greater than zero'; end if;

  select * into c from public.campaigns where id = p_campaign for update;
  if c.id is null then raise exception 'Campaign not found'; end if;
  if c.client_user_id is null then
    raise exception 'That campaign is not connected to a client account yet';
  end if;

  v_client := c.client_user_id;
  v_fx     := greatest(coalesce(c.fx_rate_per_usd,1), 0.000001);
  v_budget := coalesce(c.budget,0);
  v_used   := coalesce(c.budget_used,0);
  v_fee    := public.campaign_fee(c);
  v_floor  := v_used + v_fee;              -- delivered work plus the taken cut (native)
  v_free   := greatest(v_budget - v_floor, 0);
  v_free_usd := round(floor(v_free / v_fx * 100) / 100, 2);
  v_native := round(v_usd * v_fx, 2);

  if v_usd > v_free_usd then
    raise exception 'Only % USD can be returned: % % is already delivered and % % is platform fee',
      v_free_usd, v_used, coalesce(c.currency,'USD'), v_fee, coalesce(c.currency,'USD');
  end if;
  if v_native > v_free then v_native := v_free; end if;

  insert into public.client_wallet_ledger(client_user_id, kind, amount, campaign_id, note, created_by)
  values (v_client, 'deallocation', v_usd, p_campaign,
          coalesce(p_note, 'Returned from campaign'), auth.uid());

  update public.campaigns set budget = v_budget - v_native, updated_at = now()
  where id = p_campaign;

  return jsonb_build_object('balance', public.client_wallet_balance(v_client),
                            'budget', v_budget - v_native,
                            'currency', coalesce(c.currency,'USD'),
                            'returned_usd', v_usd,
                            'returned_native', v_native,
                            'returnable_after', greatest(v_budget - v_native - v_floor, 0));
end $function$;

-- 4 -------------------------------------------------------------------------
-- Same function as 016, plus: spent_native / remaining_native per campaign,
-- currency + fx per clip, and the day's rates under 'fx'.
create or replace function public.client_dashboard_data()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;

  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(
        (to_jsonb(c) - 'client_pin' - 'rate_per_video' - 'rpm'
                     - 'client_rate_per_video' - 'client_rpm'
                     - 'platform_fee_percent' - 'platform_fee_amount')
        || jsonb_build_object(
             'currency',        coalesce(c.currency,'USD'),
             'fx_rate_per_usd', fx,
             'is_agency',       agency,
             'rate_per_video_native', unit,
             'rpm_native',            case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end,
             'rate_per_video', round(unit/fx, 2),
             'rpm',            round((case when agency then coalesce(c.client_rpm,0)
                                           else coalesce(c.rpm,0) end)/fx, 2),
             'budget_native',  coalesce(c.budget,0),
             'budget',         round(coalesce(c.budget,0)/fx, 2),
             'spent_native',   round(spent_native, 2),
             'spent',          round(spent_native/fx, 2),
             'remaining_native', greatest(round(coalesce(c.budget,0) - spent_native, 2), 0),
             'remaining',      greatest(round((coalesce(c.budget,0) - spent_native)/fx, 2), 0),
             'platform_fee_native', case when agency then null
                                    else round(public.campaign_fee(c), 2) end,
             'platform_fee',   case when agency then null
                                    else round(public.campaign_fee(c)/fx, 2) end,
             'creator_pool_native', case when agency then null
                                    else round(public.campaign_creator_pool(c), 2) end,
             'creator_pool',   case when agency then null
                                    else round(public.campaign_creator_pool(c)/fx, 2) end,
             'can_fund',       (c.client_user_id = uid),
             'shared_with',    (select count(*) from public.campaign_clients x
                                 where x.campaign_id = c.id and x.client_user_id <> uid)
           )
        order by c.created_at desc)
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      cross join lateral (select greatest(public.campaign_rate_ratio(c),0.000001) as ratio) g
      cross join lateral (select public.campaign_agency_margin(c) > 0 as agency) h
      cross join lateral (select public.campaign_client_unit_rate(c) as unit) u
      cross join lateral (
        select case when coalesce(c.payout_model,'per_view') = 'per_video'
                    then (select count(*) from public.clip_submissions s
                           where s.campaign_id = c.id::text and s.status = 'approved') * unit
                    else coalesce(c.budget_used,0) / ratio end as spent_native) sp
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid), '[]'::jsonb),

    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'campaign_id', s.campaign_id, 'campaign_title', s.campaign_title,
               'platform', s.platform, 'handle', s.handle, 'clip_url', s.clip_url,
               'views', s.views_count, 'likes', s.likes, 'comments', s.comments,
               'engagement_rate', s.engagement_rate, 'status', s.status,
               'currency', coalesce(c.currency,'USD'),
               'fx_rate_per_usd', greatest(coalesce(c.fx_rate_per_usd,1),0.000001),
               'earned', case when pv
                              then round(public.campaign_client_unit_rate(c)
                                         / greatest(coalesce(c.fx_rate_per_usd,1),0.000001), 2)
                              else round(coalesce(s.approved_amount,0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,
               'earned_native', case when pv
                              then round(public.campaign_client_unit_rate(c), 2)
                              else round(coalesce(s.earning_amount_native, s.approved_amount, 0)
                                         / greatest(public.campaign_rate_ratio(c),0.000001), 2) end,
               'created_at', s.created_at,
               'flagged_at', s.flagged_at,
               'flag', (select jsonb_build_object(
                          'id', f.id, 'reason', f.reason,
                          'by', coalesce(f.flagged_email, 'a client'),
                          'by_me', (f.flagged_by = uid),
                          'resolution', f.resolution,
                          'note', f.resolution_note,
                          'at', f.created_at)
                        from public.clip_flags f
                        where f.submission_id = s.id
                        order by f.created_at desc limit 1)))
      from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
      cross join lateral (select coalesce(c.payout_model,'per_view') = 'per_video' as pv) m
      where s.status in ('approved','flagged')
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    'wallet', jsonb_build_object(
      'currency', 'USD',
      'balance', public.client_wallet_balance(uid),
      'ledger', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', l.id, 'kind', l.kind, 'amount', l.amount,
                 'campaign_id', l.campaign_id, 'note', l.note, 'created_at', l.created_at)
               order by l.created_at desc)
        from public.client_wallet_ledger l
        where l.client_user_id = uid), '[]'::jsonb)
    ),

    'fx', public.cx_fx_rates_public(),

    'totals', (
      select jsonb_build_object(
        'currency',     'USD',
        'funded',       coalesce(sum(round(coalesce(c.budget,0)/f.fx, 2)),0),
        'platform_fee', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_fee(c)/f.fx, 2)),0) end,
        'creator_pool', case when bool_or(public.campaign_agency_margin(c) > 0) then null
                             else coalesce(sum(round(public.campaign_creator_pool(c)/f.fx, 2)),0) end,
        'spent',        coalesce(sum(round(
                          case when coalesce(c.payout_model,'per_view') = 'per_video'
                               then (select count(*) from public.clip_submissions s
                                      where s.campaign_id = c.id::text and s.status = 'approved')
                                    * public.campaign_client_unit_rate(c)
                               else coalesce(c.budget_used,0)
                                    / greatest(public.campaign_rate_ratio(c),0.000001) end
                          / f.fx, 2)),0)
      )
      from public.campaigns c
      cross join lateral (select greatest(coalesce(c.fx_rate_per_usd,1),0.000001) as fx) f
      where exists (select 1 from public.campaign_clients cc
                     where cc.campaign_id = c.id and cc.client_user_id = uid)
         or c.client_user_id = uid
    )
  ) into result;

  return result;
end
$function$;
