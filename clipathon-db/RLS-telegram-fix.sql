-- =============================================================
-- SECURITY: telegram_config and telegram_pending_actions
-- =============================================================
-- DO NOT RUN THIS BLIND. Read the note at the bottom first.
--
-- These two tables in `public` currently have Row Level Security
-- switched OFF. Every other table in the database has it on. With RLS
-- off, PostgREST exposes them to the `anon` and `authenticated` roles,
-- which means anyone holding your publishable anon key (it ships in the
-- front end, it is not a secret) can:
--
--   select * from telegram_config;              -- read every row
--   update telegram_config set value = '...';   -- rewrite every row
--   delete from telegram_pending_actions;       -- empty the table
--
-- telegram_config is a key/value table with 6 rows. If any of those
-- values is a bot token, a chat id or a webhook secret, it is currently
-- readable by the public and should be treated as compromised and
-- rotated, not just locked down.
--
-- telegram_pending_actions holds message_id, chat_id, thread_id,
-- action and target_id. A writer could approve or reject things by
-- forging rows, depending on what the bot does with them.
--
-- This predates the Clipathon work and is unrelated to it. Nothing in
-- clipathon-db/ touches either table.
-- =============================================================


-- -------------------------------------------------------------
-- STEP 1 · find out who is actually reading these
-- -------------------------------------------------------------
-- Run this FIRST. It tells you whether anything is talking to these
-- tables through the anon or authenticated roles rather than through
-- service_role. If the answer is "only service_role", step 2 is safe
-- and nothing breaks.
--
-- In the Supabase dashboard: Logs -> Postgres, filter the last 7 days
-- for 'telegram_config'. Or check which of these applies:
--
--   * an Edge Function using SUPABASE_SERVICE_ROLE_KEY   -> safe, bypasses RLS
--   * a server side script with the service role key      -> safe
--   * a cron job / n8n / Make webhook with the anon key   -> WILL BREAK
--   * anything in the browser reading telegram_config     -> WILL BREAK,
--     and is also the bug, because that means the config is in the client
--
-- The Telegram bot almost certainly runs server side, which means
-- service_role, which bypasses RLS entirely. That is the normal case
-- and step 2 will be invisible to it.


-- -------------------------------------------------------------
-- STEP 2 · lock both tables down
-- -------------------------------------------------------------
-- The correct end state for these two tables is: no browser access at
-- all. They are backend plumbing. service_role bypasses RLS, so
-- enabling RLS with NO policies is not a mistake here, it is the goal.

begin;

alter table public.telegram_config           enable row level security;
alter table public.telegram_pending_actions  enable row level security;

-- Belt and braces: also drop the direct grants, so even a future
-- permissive policy cannot re-expose them by accident.
revoke all on public.telegram_config          from anon, authenticated;
revoke all on public.telegram_pending_actions from anon, authenticated;

commit;

-- After this: service_role keeps full access, anon and authenticated
-- get nothing. No policies are needed and none should be added.


-- -------------------------------------------------------------
-- STEP 3 · only if step 1 found an admin console reading these
-- -------------------------------------------------------------
-- If your admin console reads telegram_config in the browser using the
-- signed-in user's session rather than a service key, add a read policy
-- scoped to your existing admin list instead of leaving RLS off.
--
-- Uncomment only if that is genuinely the case.

-- create policy telegram_config_admin_read on public.telegram_config
--   for select to authenticated
--   using (exists (
--     select 1 from public.admin_users a where a.user_id = auth.uid()
--   ));

-- create policy telegram_pending_admin_all on public.telegram_pending_actions
--   for all to authenticated
--   using (exists (
--     select 1 from public.admin_users a where a.user_id = auth.uid()
--   ))
--   with check (exists (
--     select 1 from public.admin_users a where a.user_id = auth.uid()
--   ));


-- -------------------------------------------------------------
-- STEP 4 · rotate anything that was exposed
-- -------------------------------------------------------------
-- Locking the door does not un-leak what was already readable. If
-- telegram_config held a bot token, revoke it with @BotFather and issue
-- a new one. Check what is in there first:
--
--   select key from public.telegram_config;    -- keys only, not values
--
-- Any key that looks like a token, secret, password or webhook URL
-- should be rotated on the assumption it is public.


-- -------------------------------------------------------------
-- Rollback, if something does break
-- -------------------------------------------------------------
-- alter table public.telegram_config          disable row level security;
-- alter table public.telegram_pending_actions disable row level security;
-- grant all on public.telegram_config          to anon, authenticated;
-- grant all on public.telegram_pending_actions to anon, authenticated;
