-- 068: Remove now really removes a connected account, even when it has clips.
--
-- Before: an account with clips was only taken off its campaigns and stayed on the
-- creator's profile (and the creator's own dashboard), so "Remove" looked broken.
-- Now: it is also marked status = 'removed', which hides it everywhere accounts are
-- listed and stops it submitting (every submit path requires status = 'verified').
-- Its clips are not touched: clip_submissions has no foreign key to this table, rows
-- keep their connected_account_id, and every clip count / view total / payout reads
-- clip_submissions directly, so approved videos keep counting on the client dashboard,
-- the creator's dashboard and the Content Calendar.
-- Accounts with no clips are still deleted, as before.

create or replace function public.admin_remove_account(p_account uuid)
returns text
language plpgsql security definer set search_path = public as $$
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
    update public.connected_accounts
       set status = 'removed', rejection_reason = 'Removed by Clipency.', updated_at = now()
     where id = p_account;
    return 'removed';
  end if;
  delete from public.connected_accounts where id = p_account;
  return 'deleted';
end $$;

revoke all on function public.admin_remove_account(uuid) from public, anon;
grant execute on function public.admin_remove_account(uuid) to authenticated;
