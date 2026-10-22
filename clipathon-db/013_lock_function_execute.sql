-- =============================================================
-- CLIPATHON · 013 · take EXECUTE away from PUBLIC
-- =============================================================
-- Found immediately after 012 exposed the schema to PostgREST.
--
-- Postgres grants EXECUTE on every new function to PUBLIC by default.
-- `revoke ... from anon` in 012 did nothing about that, because anon
-- inherits the privilege through PUBLIC rather than holding it directly.
-- The result: exposing the schema published all 25 functions as RPC
-- endpoints reachable with the publishable key, including is_admin(),
-- has_role() and write_audit(), which are SECURITY DEFINER.
--
-- Not catastrophic on its own. has_role() returns false for a caller
-- with no admin row, and the trigger functions error out when called
-- directly. But write_audit() could have been used to write junk into
-- the audit trail, and none of this belongs on the public API surface.
--
-- The fix has three parts, and the third is the one that matters
-- long term: without the default-privileges line, the very next
-- function anyone adds re-opens the same hole silently.
-- =============================================================

-- 1. Nobody, by default.
revoke execute on all functions in schema clipathon from public;
revoke execute on all functions in schema clipathon from anon, authenticated;

-- 2. Future functions inherit the lock rather than PUBLIC's grant.
alter default privileges in schema clipathon revoke execute on functions from public;

-- 3. Grant back, explicitly, only what each role actually calls.

-- anon gets exactly one thing: public signup.
grant execute on function clipathon.register_creator(
  text, text, text, text, text, text, text, text, text[], text, boolean) to anon;

-- A signed-in creator calls these four directly.
grant execute on function clipathon.register_creator(
  text, text, text, text, text, text, text, text, text[], text, boolean) to authenticated;
grant execute on function clipathon.link_auth_user()                     to authenticated;
grant execute on function clipathon.request_account_code(text, text)     to authenticated;
grant execute on function clipathon.submit_account_for_check(text, text) to authenticated;

-- And these four indirectly: an RLS policy expression is evaluated as
-- the querying role, so `using (clipathon.is_admin())` fails outright
-- unless authenticated may execute it. anon is deliberately excluded,
-- since anon holds no table grant that could trigger a policy at all.
grant execute on function clipathon.is_admin()                       to authenticated;
grant execute on function clipathon.has_role(clipathon.admin_role[]) to authenticated;
grant execute on function clipathon.my_creator_id()                  to authenticated;
grant execute on function clipathon.owns_registration(uuid)          to authenticated;

-- The trigger functions are granted to nobody on purpose. Postgres does
-- not check EXECUTE when firing a trigger, so they keep working while
-- being unreachable over the API.
