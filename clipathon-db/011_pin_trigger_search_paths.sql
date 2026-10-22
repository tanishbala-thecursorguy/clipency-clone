-- =============================================================
-- CLIPATHON · 011 · pin search_path on the plain trigger functions
-- =============================================================
-- Raised by Supabase's own security advisor after 001 to 010 were
-- deployed: nine functions had a role-mutable search_path.
--
-- None of them are SECURITY DEFINER, so an unpinned path could not
-- escalate privilege the way it could in is_admin() or claim_slot(),
-- which were pinned from the start. But shift_cycle_schedule() and
-- sync_submission_status() do reference clipathon tables by name, and a
-- resolvable path means a caller able to create objects in their own
-- schema could change which table a trigger reads.
--
-- Cheap to close. After this, all 21 functions in the schema are pinned
-- and the schema reports zero advisor findings of its own.
-- =============================================================

alter function clipathon.touch_updated_at()            set search_path = clipathon, pg_temp;
alter function clipathon.derive_cycle_clock()          set search_path = clipathon, pg_temp;
alter function clipathon.shift_cycle_schedule()        set search_path = clipathon, pg_temp;
alter function clipathon.sync_submission_status()      set search_path = clipathon, pg_temp;
alter function clipathon.block_snapshot_mutation()     set search_path = clipathon, pg_temp;
alter function clipathon.freeze_scoring()              set search_path = clipathon, pg_temp;
alter function clipathon.freeze_prizes()               set search_path = clipathon, pg_temp;
alter function clipathon.set_ticket_sla()              set search_path = clipathon, pg_temp;
alter function clipathon.set_announcement_schedule()   set search_path = clipathon, pg_temp;
