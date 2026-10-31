-- 050: client portal > Creators lists every creator approved for the campaign,
-- including those who have not posted yet (0 clips, 0 views).
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-31 with the owner's approval.
--
-- client_dashboard_data gains one key, 'roster': the verified accounts with an
-- approved application on the client's own campaigns (same campaign scoping as
-- 'pending'). Removed/rejected creators are not included. The rest of the function
-- is untouched (patched in place from its current definition); grants are kept.

do $$
declare d text := pg_get_functiondef('public.client_dashboard_data'::regproc);
        anchor text := '''fx'', public.cx_fx_rates_public(),';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'client_dashboard_data changed; patch not applied';
  end if;
  execute replace(d, anchor,
$r$'roster', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
               'campaign_id', c.id, 'campaign_title', c.title,
               'platform', a.platform, 'handle', a.handle))
      from public.campaign_applications ap
      join public.connected_accounts a on a.id = ap.connected_account_id
      join public.campaigns c on c.id = ap.campaign_id
      where ap.status = 'approved' and a.status = 'verified'
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    $r$ || anchor);
end $$;
