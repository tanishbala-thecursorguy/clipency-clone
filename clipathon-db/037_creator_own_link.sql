-- =============================================================
-- CLIPATHON · 037 · a creator's own link, and what it did
-- =============================================================
-- Every creator has been a referrer since the schema was written.
-- creators.referral_code is generated at registration, and
-- track_ref_click() in 034 accepts it with no ref_links row behind
-- it on purpose, so a creator's link works the moment they sign up
-- and needs nothing from the console.
--
-- What was missing was anywhere to see it, and anywhere to see
-- whether it did anything. Two counters keyed on that code:
--
--   own_link_taps      taps recorded on the bridge page
--   own_link_people    distinct browsers behind those taps
--   own_link_signups   registrations that arrived carrying the code
--   own_link_approved  the ones that survived review
--
-- Signups are scoped to the creator's own cycle. A code belongs to
-- a person forever, but a cycle's numbers are a cycle's numbers.
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
    r.ref_code_used,
    COALESCE(( SELECT a.handle
           FROM clipathon.creator_accounts a
          WHERE a.creator_id = c.id AND a.platform::text = 'instagram'::text AND COALESCE(btrim(a.handle), ''::text) <> ''::text
          ORDER BY (a.status::text = 'verified'::text) DESC, a.is_primary DESC, a.created_at
         LIMIT 1),
        CASE
            WHEN r.primary_profile_url ~* '(instagram\.com|instagr\.am)'::text THEN NULLIF(btrim(regexp_replace(regexp_replace(r.primary_profile_url, '^\s*https?://[^/]*/'::text, ''::text, 'i'::text), '[/?#].*$'::text, ''::text)), ''::text)
            ELSE NULL::text
        END) AS ig_handle,
    (EXISTS ( SELECT 1
           FROM clipathon.creator_accounts a
          WHERE a.creator_id = c.id AND a.platform::text = 'instagram'::text AND a.status::text = 'verified'::text)) AS ig_verified,
    ( SELECT string_agg((a.platform::text || ':'::text) || a.handle, ', '::text ORDER BY (a.platform::text)) AS string_agg
           FROM clipathon.creator_accounts a
          WHERE a.creator_id = c.id AND COALESCE(btrim(a.handle), ''::text) <> ''::text) AS all_handles,
    ( SELECT count(*) AS count
           FROM clipathon.ref_clicks k
          WHERE upper(k.code) = upper(c.referral_code)) AS own_link_taps,
    ( SELECT count(DISTINCT k.visitor) AS count
           FROM clipathon.ref_clicks k
          WHERE upper(k.code) = upper(c.referral_code) AND k.visitor IS NOT NULL) AS own_link_people,
    ( SELECT count(*) AS count
           FROM clipathon.registrations g
          WHERE g.cycle_id = r.cycle_id AND upper(COALESCE(g.ref_code_used, ''::text)) = upper(c.referral_code)) AS own_link_signups,
    ( SELECT count(*) AS count
           FROM clipathon.registrations g
          WHERE g.cycle_id = r.cycle_id AND upper(COALESCE(g.ref_code_used, ''::text)) = upper(c.referral_code) AND g.status = 'approved'::clipathon.registration_status) AS own_link_approved
   FROM clipathon.creators c
     JOIN clipathon.registrations r ON r.creator_id = c.id;
