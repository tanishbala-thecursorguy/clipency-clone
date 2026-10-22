-- =============================================================
-- CLIPATHON · 035 · the console can see a phone number
-- =============================================================
-- The number is collected at signup and sits on the creator row. It
-- just never reached v_creator_readiness, which is what the Creators
-- page reads, so an operator could email a creator and not ring them.
--
-- Added at the END of the select list on purpose: create or replace
-- view refuses to reorder or drop existing columns, and appending
-- means nothing already reading this view has to change.
--
-- ALREADY APPLIED to the live project. Kept here as the record.
-- =============================================================
create or replace view clipathon.v_creator_readiness
with (security_invoker = on) as
 SELECT c.id AS creator_id,
    c.creator_code,
    c.full_name,
    c.email,
    c.city,
    c.campus,
    r.cycle_id,
    r.status AS registration_status,
    c.auth_user_id IS NOT NULL AS has_login,
    ( SELECT max(e.created_at) AS max
           FROM clipathon.login_events e
          WHERE e.creator_id = c.id) AS last_login_at,
    (EXISTS ( SELECT 1
           FROM clipathon.creator_accounts a
          WHERE a.creator_id = c.id AND a.status = 'verified'::clipathon.account_status)) AS has_verified_account,
    (EXISTS ( SELECT 1
           FROM clipathon.slots s
          WHERE s.registration_id = r.id)) AS has_slot,
    r.status = 'approved'::clipathon.registration_status AND c.auth_user_id IS NOT NULL AND (EXISTS ( SELECT 1
           FROM clipathon.creator_accounts a
          WHERE a.creator_id = c.id AND a.status = 'verified'::clipathon.account_status)) AS ready_for_slot_selection,
    c.phone,
    c.phone_verified_at,
    c.referral_code,
    r.primary_profile_url,
    r.ref_code_used
   FROM clipathon.creators c
     JOIN clipathon.registrations r ON r.creator_id = c.id;
