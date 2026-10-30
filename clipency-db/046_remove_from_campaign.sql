-- 046: console > Creators > profile: "Remove" a creator from a private campaign.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-30 with the owner's approval.
--
-- One new function, no table change. Removing turns this creator's applications
-- for the campaign into 'rejected' (reason shown to them), so the private campaign
-- disappears from their dashboard. Clips, views and payouts are left as they are,
-- no email goes out, and Connect (admin_grant_campaign_access) adds them back.

create or replace function public.admin_remove_from_campaign(p_user uuid, p_campaign uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.campaign_applications
     set status = 'rejected', rejection_reason = 'Removed from this campaign by Clipency.',
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where user_id = p_user and campaign_id = p_campaign and status <> 'rejected';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.admin_remove_from_campaign(uuid, uuid) from public, anon;
grant  execute on function public.admin_remove_from_campaign(uuid, uuid) to authenticated;
