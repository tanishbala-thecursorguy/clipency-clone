-- 047: console > Creators > By campaign: new access filter 'current' (the console default),
-- which hides creators whose access to the campaign was only rejected or removed.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-30 with the owner's approval.
--
-- Adds one case to admin_list_creators' p_access switch; the rest of the function is
-- untouched (patched in place from its current definition), grants are kept.

do $$
declare d text := pg_get_functiondef('public.admin_list_creators'::regproc);
        old text := 'when ''rejected'' then r.apps_rej > 0 when ''none'' then r.apps_n = 0 else true end';
begin
  if position(old in d) = 0 then raise exception 'admin_list_creators changed; patch not applied'; end if;
  execute replace(d, old,
    'when ''rejected'' then r.apps_rej > 0 when ''none'' then r.apps_n = 0 ' ||
    'when ''current'' then not (r.apps_rej > 0 and r.apps_appr = 0 and r.apps_pend = 0) else true end');
end $$;
