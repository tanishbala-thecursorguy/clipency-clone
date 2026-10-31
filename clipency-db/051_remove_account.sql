-- 051: console > Creators > profile > Connected accounts: "Remove" one account.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-31 with the owner's approval.
--
-- One new admin-only function, no table change.
--   account with no clips   -> deleted (its campaign applications and tokens go with it, by cascade)
--   account with any clips  -> kept, but taken off every campaign (applications set to
--                              rejected, "Removed by Clipency"); clips, views, payouts untouched
-- No email is sent either way.

create or replace function public.admin_remove_account(p_account uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.cx_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.connected_accounts where id = p_account) then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.clip_submissions where connected_account_id = p_account) then
    update public.campaign_applications
       set status = 'rejected', rejection_reason = 'Removed from this campaign by Clipency.',
           reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     where connected_account_id = p_account and status <> 'rejected';
    return 'removed_from_campaigns';
  end if;
  delete from public.connected_accounts where id = p_account;
  return 'deleted';
end $$;
revoke execute on function public.admin_remove_account(uuid) from public, anon;
grant  execute on function public.admin_remove_account(uuid) to authenticated;
