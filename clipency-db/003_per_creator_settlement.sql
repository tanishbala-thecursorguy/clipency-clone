/* Applied to spwtkdgpgeutrhwcjrpy on 2026-09-08.
   Per-creator settlement for per_video campaigns.

   "Minimum videos to get paid" is retroactive: the first videos are HELD
   at zero, not forfeited, and all of them pay the moment the creator
   reaches the minimum. Approving one clip can therefore change the value
   of clips approved weeks earlier — which a row-level BEFORE trigger
   cannot express, since it only sees its own row. So money on these
   campaigns is settled per (creator, campaign) as a set, from an AFTER
   trigger.

   THE TRAP, and why this took two attempts: cs_freeze_metrics() is a
   BEFORE UPDATE guard that reverts earnings for any writer that is not
   service_role, staff, or flagged as a trusted write. Settlement runs
   inside the clipper's own INSERT, so every write it made was silently
   reverted — no error, just earnings that stayed null. It now claims
   clipency.trusted_write (the escape hatch the codebase already defines)
   around its loop and drops it immediately after. */

create or replace function public.cx_settle_creator_campaign(p_user uuid, p_campaign text)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  c public.campaigns%rowtype;
  v_pool numeric; v_min int; v_maxv int; v_maxpay numeric;
  v_others numeric; v_room numeric;
  v_delivered int := 0; v_paid_count int := 0; v_total numeric := 0;
  v_rate numeric; v_fx numeric; v_amt numeric; v_usd numeric;
  r public.clip_submissions%rowtype;
begin
  if p_user is null or p_campaign is null then return; end if;
  select * into c from public.campaigns where id::text = p_campaign;
  if not found then return; end if;
  if coalesce(c.payout_model,'per_view') <> 'per_video' then return; end if;
  /* A finished campaign holds every clip where it is. */
  if c.status is distinct from 'active' then return; end if;

  v_pool   := public.campaign_creator_pool(c);
  v_min    := coalesce(c.min_videos_per_creator, 0);
  v_maxv   := c.max_videos_per_creator;
  v_maxpay := c.max_pay_per_creator;

  select coalesce(sum(coalesce(s.earning_amount_native, s.earning_amount, 0)), 0) into v_others
  from public.clip_submissions s
  where s.campaign_id = p_campaign and s.status = 'approved' and s.user_id <> p_user;
  v_room := floor(greatest(v_pool - v_others, 0) * 100) / 100;

  /* A video only counts toward the minimum if it actually qualifies, or a
     creator could clear the bar with clips that were never going to pay. */
  select count(*) into v_delivered
  from public.clip_submissions s
  where s.campaign_id = p_campaign and s.user_id = p_user and s.status = 'approved'
    and coalesce(s.views_count, 0) >= coalesce(c.min_views_per_clip, 0)
    and coalesce(s.metrics_status, '') = 'ok';

  perform set_config('cx.settling', '1', true);
  perform set_config('clipency.trusted_write', '1', true);

  for r in
    select s.* from public.clip_submissions s
    where s.campaign_id = p_campaign and s.user_id = p_user and s.status = 'approved'
    order by s.created_at, s.id
  loop
    v_rate := coalesce(r.rate_per_video_at_approval, c.rate_per_video, 0);
    v_fx   := greatest(coalesce(r.fx_rate_per_usd_at_approval, c.fx_rate_per_usd, 1), 0.000001);
    v_amt  := 0;
    if v_delivered >= v_min
       and coalesce(r.views_count, 0) >= coalesce(c.min_views_per_clip, 0)
       and coalesce(r.metrics_status, '') = 'ok'
       and v_rate > 0
       and (v_maxv is null or v_maxv <= 0 or v_paid_count < v_maxv)
    then
      v_amt := round(v_rate, 2);
      if c.max_pay_per_clip is not null and c.max_pay_per_clip > 0 and v_amt > c.max_pay_per_clip then
        v_amt := c.max_pay_per_clip; end if;
      if v_maxpay is not null and v_maxpay > 0 and v_total + v_amt > v_maxpay then
        v_amt := greatest(round(v_maxpay - v_total, 2), 0); end if;
      if v_total + v_amt > v_room then
        v_amt := greatest(round(v_room - v_total, 2), 0); end if;
      if v_amt > 0 then v_paid_count := v_paid_count + 1; v_total := v_total + v_amt; end if;
    end if;

    v_usd := round(v_amt / v_fx, 2);
    if coalesce(r.earning_amount_native, -1) is distinct from v_amt
       or coalesce(r.approved_amount, -1) is distinct from v_usd then
      update public.clip_submissions
         set earning_amount_native = v_amt, approved_amount = v_usd, earning_amount = v_usd
       where id = r.id;
    end if;
  end loop;

  perform set_config('clipency.trusted_write', '0', true);
  perform set_config('cx.settling', '0', true);
end
$function$;

/* Fires on any write: a rejection, a metrics refresh or a view count
   crossing the floor can all move a creator across the minimum in either
   direction. The settling flag stops it recursing into its own updates. */
create or replace function public.cx_after_settle()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(current_setting('cx.settling', true), '0') = '1' then return null; end if;
  perform public.cx_settle_creator_campaign(new.user_id, new.campaign_id);
  return null;
end
$function$;

drop trigger if exists trg_cx_settle on public.clip_submissions;
create trigger trg_cx_settle after insert or update on public.clip_submissions
for each row execute function public.cx_after_settle();

/* cs_calc_earning keeps per_view and keeps freezing the terms a clip was
   approved under; it just no longer decides the amount for per_video. */
create or replace function public.cs_calc_earning()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  c_rpm numeric; c_per_video numeric; c_model text;
  c_min integer; c_max integer; c_cap numeric;
  c_status text; c_pool numeric; c_fx numeric;
  model text; rate numeric; fx numeric;
  paid_views numeric; amt numeric; others numeric; room numeric;
  prev_amt numeric := case when tg_op = 'UPDATE' then coalesce(old.approved_amount, 0) else 0 end;
  prev_native numeric := case when tg_op = 'UPDATE'
                              then coalesce(old.earning_amount_native, old.approved_amount, 0) else 0 end;
begin
  /* Settlement is mid-flight and owns these numbers. Leave them alone. */
  if coalesce(current_setting('cx.settling', true), '0') = '1' then return new; end if;
  if new.status is distinct from 'approved' then return new; end if;

  select c.rpm, coalesce(c.rate_per_video, 0), coalesce(c.payout_model, 'per_view'),
         coalesce(c.min_views_per_clip, 0), c.max_views_per_clip, c.max_pay_per_clip,
         c.status, public.campaign_creator_pool(c),
         greatest(coalesce(c.fx_rate_per_usd, 1), 0.000001)
    into c_rpm, c_per_video, c_model, c_min, c_max, c_cap, c_status, c_pool, c_fx
  from public.campaigns c where c.id::text = new.campaign_id;

  if c_status is distinct from 'active' then
    new.approved_amount       := prev_amt;
    new.earning_amount        := prev_amt;
    new.earning_amount_native := prev_native;
    return new;
  end if;

  if new.payout_model_at_approval is null then new.payout_model_at_approval := c_model; end if;
  if new.fx_rate_per_usd_at_approval is null then new.fx_rate_per_usd_at_approval := c_fx; end if;
  model := new.payout_model_at_approval;
  fx    := greatest(coalesce(new.fx_rate_per_usd_at_approval, 1), 0.000001);

  if model = 'per_video' then
    /* Freeze the rate, then hand over: the amount depends on how many videos
       this creator has delivered across the campaign, which is not knowable
       from this row. cx_settle_creator_campaign() runs immediately after. */
    if new.rate_per_video_at_approval is null then
      new.rate_per_video_at_approval := c_per_video;
    end if;
    return new;
  end if;

  if new.rate_per_million_at_approval is null then
    new.rate_per_million_at_approval := c_rpm;
  end if;
  rate := new.rate_per_million_at_approval;

  if rate is null or rate <= 0 then return new; end if;
  if new.metrics_status is distinct from 'ok' then return new; end if;

  if coalesce(new.views_count, 0) < c_min then
    new.approved_amount := 0; new.earning_amount := 0; new.earning_amount_native := 0;
    return new;
  end if;

  if coalesce(new.views_count, 0) <= 0 then return new; end if;
  paid_views := new.views_count;
  if c_max is not null and c_max > 0 and paid_views > c_max then paid_views := c_max; end if;
  amt := round(paid_views / 1000000 * rate, 2);
  if c_cap is not null and c_cap > 0 and amt > c_cap then amt := c_cap; end if;

  select coalesce(sum(coalesce(cs.earning_amount_native, cs.earning_amount, 0)), 0) into others
  from public.clip_submissions cs
  where cs.campaign_id = new.campaign_id and cs.status = 'approved' and cs.id <> new.id;

  room := floor(greatest(coalesce(c_pool, 0) - others, 0) * 100) / 100;
  if amt > room then amt := room; end if;

  new.earning_amount_native := amt;
  new.approved_amount       := round(amt / fx, 2);
  new.earning_amount        := new.approved_amount;
  return new;
end
$function$;
