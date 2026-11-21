-- 073: take itz_chhayascorner and khusi.finds off the Octupie campaign (owner, 2026-11-21).
-- Their campaign access is ended (same as the console's "Remove from campaign") and their
-- Content Calendar plans are paused, so no more reminders. Their clips, views and payouts are
-- not touched and keep counting everywhere. No email is sent (only approvals send one).
update public.campaign_applications
   set status = 'rejected', rejection_reason = 'Removed from this campaign by Clipency.',
       reviewed_at = now(), updated_at = now()
 where campaign_id = 'dd0f7ef5-ef1e-49c3-830e-93704fe973c7'
   and user_id in ('5b70ce44-d195-43c3-aa69-06c0eda51a4a', '7eb458a5-016d-49e6-a688-f2e5ab413842')
   and status <> 'rejected';
update public.cal_plans set status = 'paused', updated_at = now()
 where id in (19, 17) and label in ('itz_chhayascorner', 'khusi.finds');
