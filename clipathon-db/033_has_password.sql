-- 033 · Does the signed-in person already have a password?
--
-- The sign in page sent everyone to "Set your password" the moment their
-- code verified, whether or not they already had one. A returning creator
-- would confirm their email, be asked to invent a password, and get told
-- "New password should be different from the old password" -- with no way
-- forward, because the only password they know is the one being refused.
--
-- This lets the page skip that step for anyone who already has a login.
--
-- It is deliberately argument-free. A function taking an email would be an
-- account-enumeration oracle: anyone holding the publishable key could ask
-- whether an address is registered. This one reads only the caller's own
-- row, needs a live session to say anything at all, and so tells a person
-- nothing they did not already know about themselves.
create or replace function clipathon.has_password()
returns boolean
language sql
stable
security definer
set search_path = clipathon, pg_temp
as $function$
  select exists (
    select 1
      from auth.users u
     where u.id = auth.uid()
       and u.encrypted_password is not null
       and u.encrypted_password <> ''
  );
$function$;

revoke all on function clipathon.has_password() from public, anon;
grant execute on function clipathon.has_password() to authenticated;
