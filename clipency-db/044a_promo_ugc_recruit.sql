-- 044a: first Promotions email: UGC recruiting, to Clipathon registrants
-- (Clipathon project kszlfvsplkkmsgxqnakj, clipathon.registrations, not blocked),
-- minus team/test accounts, minus anyone in a Clipency campaign (none were).
-- Text approved by the owner in chat on 2026-10-29. Approved on insert; sends
-- within 2 minutes via promo_kick, rotating From across the team mailboxes.
with p as (
  insert into public.promo_emails (kind, audience, subject, html, text_body, status, send_at, approved_at, note)
  values ('ugc_recruit', 'list', 'Are you a UGC creator in India?',
$h$<div style="font:15px/1.6 Arial,sans-serif;color:#1b1a18;max-width:560px">
<p>Hi {first_name},</p>
<p>We're looking for UGC creators from India for upcoming brand campaigns on Clipency.</p>
<p>If you make UGC videos (product reviews, unboxings, talking-head ads, demos), just reply to this email with <b>"UGC"</b> and we'll send you the details.</p>
<p>Thanks,<br>Jake, Clipency</p>
</div>$h$,
$t$Hi {first_name},

We're looking for UGC creators from India for upcoming brand campaigns on Clipency.

If you make UGC videos (product reviews, unboxings, talking-head ads, demos), just reply to this email with "UGC" and we'll send you the details.

Thanks,
Jake, Clipency$t$,
  'approved', now(), now(), 'Approved by the owner in chat')
  returning id
)
select public.promo_queue_list((select id from p), :'recipients'::jsonb);
-- The 42 recipients ([{email, first_name}, ...]) were passed in at run time and are
-- deliberately not kept in the repo; they are in public.promo_sends for this promo.
