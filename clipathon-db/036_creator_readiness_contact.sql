-- =============================================================
-- CLIPATHON · 036 · the console can reach a creator
-- =============================================================
-- Supersedes 035. The Creators page could show an email and nothing
-- else, so reaching somebody on slot day meant opening a SQL client.
-- Everything added here was already on the creator or registration
-- row; it just never reached the view the page reads.
--
--   phone, phone_verified_at   collected at signup
--   referral_code              their own code, for tracing a referral
--   primary_profile_url        the link they registered with
--   ref_code_used              whose link brought them in
--   ig_handle                  best known Instagram handle: a verified
--                              connected account if there is one, else
--                              parsed out of the registration URL with
--                              the ?stkn= token Instagram staples on
--                              when a profile is shared from the app
--   ig_verified                the bio code was actually checked, which
--                              is a different claim from "they typed an
--                              instagram url"
--   all_handles                every connected account, any platform
--
-- Appended at the END of the select list on purpose: create or replace
-- view refuses to reorder or drop existing columns, so appending means
-- nothing already reading this view has to change.
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
          WHERE a.creator_id = c.id AND COALESCE(btrim(a.handle), ''::text) <> ''::text) AS all_handles
   FROM clipathon.creators c
     JOIN clipathon.registrations r ON r.creator_id = c.id;
