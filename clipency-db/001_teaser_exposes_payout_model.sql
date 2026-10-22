/* Applied to Supabase project spwtkdgpgeutrhwcjrpy on 2026-09-08.
   Recorded here after the fact — this repo had no migrations folder for the
   Clipency project, only clipathon-db/ for the other one.

   Why: cx_private_campaign_teasers() withheld the payout MODEL along with the
   rate, so the clipper-side card labelled a flat per-video campaign as
   "Rate / 1M" — a wrong unit, not a rounding error.

   The model is not pricing. Knowing a campaign pays a flat fee per approved
   video rather than betting on views is part of deciding whether to apply, and
   it reveals no figure. The rate itself stays withheld exactly as before: this
   adds two keys to the jsonb and changes nothing about the WHERE clause or the
   security posture. */

create or replace function public.cx_private_campaign_teasers()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'brand_name', c.brand_name,
      'icon_url', c.icon_url,
      'asset_url', c.asset_url,
      'platform', c.platform,
      'genre', coalesce(c.genre, c.category),
      'is_new', c.is_new,
      'start_date', c.start_date,
      'end_date', c.end_date,
      'is_private', true,
      'locked', true,
      -- the unit, never the figure
      'payout_model', coalesce(c.payout_model,'per_view'),
      'rate_label', case when coalesce(c.payout_model,'per_view') = 'per_video'
                         then 'Rate per Video' else 'Rate per 1M Views' end,
      -- budget only: enough to judge whether it is worth applying
      'currency', coalesce(c.currency,'USD'),
      'fx_rate_per_usd', greatest(coalesce(c.fx_rate_per_usd,1),0.000001),
      'budget', coalesce(c.budget,0),
      'budget_used', coalesce(c.budget_used,0),
      'platform_fee', public.campaign_fee(c),
      'creator_pool', public.campaign_creator_pool(c),
      'creators_count', coalesce(c.creators_count,0),
      'my_application', (
        select jsonb_build_object(
                 'status', a.status,
                 'attempt', a.attempt,
                 'rejection_reason', a.rejection_reason,
                 'can_reapply', (a.status = 'rejected' and a.attempt < 2),
                 'handle', ca.handle,
                 'platform', ca.platform,
                 'created_at', a.created_at)
        from public.campaign_applications a
        join public.connected_accounts ca on ca.id = a.connected_account_id
        where a.campaign_id = c.id and a.user_id = v_uid
        order by a.updated_at desc limit 1)
      ) order by c.created_at desc)
    from public.campaigns c
    where c.is_private = true
      and c.status = 'active'
      and not public.cx_is_approved_for_campaign(c.id)
  ), '[]'::jsonb);
end
$function$;

grant execute on function public.cx_private_campaign_teasers() to anon, authenticated;
