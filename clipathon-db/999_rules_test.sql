\set ON_ERROR_STOP on
\pset pager off
set search_path = clipathon, public;

-- tiny assertion helper
create or replace function assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond then raise notice '  ok   %', label;
  else raise exception 'FAILED: %', label; end if;
end $$;

create or replace function expect_error(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    raise exception 'FAILED: % (statement was allowed but should have been rejected)', label;
  exception
    when others then
      if sqlerrm like 'FAILED:%' then raise; end if;
      raise notice '  ok   % (blocked: %)', label, left(sqlerrm, 60);
  end;
end $$;

do $$
declare
  cy uuid; se uuid; b1 uuid; b2 uuid;
  c_ref uuid; c_kid uuid; c_other uuid;
  r_ref uuid; r_kid uuid; r_other uuid;
  s_kid uuid; sub_kid uuid; t1 uuid; tc1 uuid;
  n integer; v numeric; ts timestamptz;
begin
  select id into se from seasons where code = 'season-1';
  select id into cy from cycles  where code = 'cycle-01';
  select id into b1 from brands  where cycle_id = cy and slug = 'orbit';
  select id into b2 from brands  where cycle_id = cy and slug = 'kavi';

  raise notice '--- cycle clock ---';
  perform assert((select finale_at from cycles where id = cy)
                 = (select registration_closes + interval '5 days' from cycles where id = cy),
                 'finale derived from registration_closes');
  perform assert((select submission_cutoff_at from cycles where id = cy)
                 = (select slots_close_at + interval '72 hours' from cycles where id = cy),
                 '72 hour clock starts when the slot window shuts');
  perform assert((select total_slots from cycles where id = cy) = 500, 'total slots = 5 x 100');

  -- moving the anchor moves everything
  update cycles set registration_closes = registration_closes + interval '1 day' where id = cy;
  perform assert((select finale_at from cycles where id = cy)
                 = (select registration_closes + interval '5 days' from cycles where id = cy),
                 're-dating the cycle re-dates the whole clock');
  update cycles set registration_closes = registration_closes - interval '1 day' where id = cy;

  raise notice '--- creators and registrations ---';
  insert into creators (creator_code, full_name, display_name, email, phone, referral_code, city)
    values ('CLP-0001','Ref Errer','referrer','ref@test.in','+911111111111','CLIP-0001','Bangalore') returning id into c_ref;
  insert into creators (creator_code, full_name, display_name, email, phone, referral_code, city)
    values ('CLP-0002','Kid Referred','thekid','kid@test.in','+912222222222','CLIP-0002','Bangalore') returning id into c_kid;
  insert into creators (creator_code, full_name, display_name, email, phone, referral_code, city)
    values ('CLP-0003','Some Body','somebody','other@test.in','+913333333333','CLIP-0003','Bangalore') returning id into c_other;

  insert into registrations (cycle_id, creator_id, primary_profile_url, status, reviewed_at)
    values (cy, c_ref, 'https://instagram.com/referrer', 'approved', now()) returning id into r_ref;
  insert into registrations (cycle_id, creator_id, primary_profile_url, referred_by, status)
    values (cy, c_kid, 'https://instagram.com/thekid', c_ref, 'pending') returning id into r_kid;
  insert into registrations (cycle_id, creator_id, primary_profile_url, status, reviewed_at)
    values (cy, c_other, 'https://instagram.com/somebody', 'approved', now()) returning id into r_other;

  perform assert((select count(*) from referrals where referrer_id = c_ref) = 1,
                 'referral row created from the attributed registration');
  perform assert((select stage from referrals where referred_creator_id = c_kid) = 'invited',
                 'new referral starts at invited');

  perform expect_error(
    format('insert into registrations (cycle_id, creator_id, primary_profile_url, referred_by) values (%L,%L,%L,%L)',
           cy, c_other, 'x', c_other),
    'self referral rejected');

  raise notice '--- referral: signup and verification pay nothing ---';
  update registrations set status = 'approved', reviewed_at = now() where id = r_kid;
  perform assert((select stage from referrals where referred_creator_id = c_kid) = 'verified',
                 'approved registration advances the referral to verified');
  perform assert((select coalesce(sum(amount),0) from points_ledger
                  where creator_id = c_ref and source = 'referral') = 0,
                 'VERIFIED referral has paid nothing');

  raise notice '--- slot capacity ---';
  -- Put the cycle clock where the slot window is genuinely open right
  -- now. The trigger checks real time, which is the point of it.
  update cycles set registration_closes = now() - interval '25 hours', status = 'slot_selection' where id = cy;
  insert into slots (cycle_id, registration_id, brand_id) values (cy, r_kid, b1) returning id into s_kid;
  perform assert((select slots_taken from brands where id = b1) = 1, 'slot counter incremented');

  perform expect_error(
    format('insert into slots (cycle_id, registration_id, brand_id) values (%L,%L,%L)', cy, r_kid, b2),
    'one slot per creator, second insert rejected');

  -- fill the brand and prove the capacity guard fires
  update brands set slots_taken = slots_total where id = b2;
  perform expect_error(
    format('insert into slots (cycle_id, registration_id, brand_id) values (%L,%L,%L)', cy, r_other, b2),
    'full brand cannot be oversold');
  update brands set slots_taken = 0 where id = b2;

  raise notice '--- submission ladder ---';
  insert into submissions (cycle_id, registration_id, brand_id, slot_id)
    values (cy, r_kid, b1, s_kid) returning id into sub_kid;
  perform assert((select status from submissions where id = sub_kid) = 'not_started', 'starts at not_started');

  update submissions set post_url = 'https://instagram.com/reel/abc', platform = 'instagram' where id = sub_kid;
  perform assert((select status from submissions where id = sub_kid) = 'link_submitted', 'link advances the ladder');
  perform assert((select is_complete from submissions where id = sub_kid) = false, 'link alone is not complete');
  perform assert((select coalesce(sum(amount),0) from points_ledger where creator_id = c_ref and source='referral') = 0,
                 'SUBMITTED referral still pays nothing');

  update submissions set drive_url = 'https://drive.google.com/x', file_name='a.mp4' where id = sub_kid;
  perform assert((select status from submissions where id = sub_kid) = 'complete', 'both paths = complete');
  perform assert((select is_complete from submissions where id = sub_kid), 'is_complete generated correctly');
  perform assert((select stage from referrals where referred_creator_id = c_kid) = 'submitted',
                 'complete submission advances the referral to submitted');
  perform assert((select coalesce(sum(amount),0) from points_ledger where creator_id = c_ref and source='referral') = 0,
                 'still nothing paid before approval');

  raise notice '--- THE RULE: approval is what pays ---';
  update submissions set status = 'verified' where id = sub_kid;
  perform assert((select stage from referrals where referred_creator_id = c_kid) = 'approved',
                 'verified submission advances the referral to approved');
  perform assert((select points_awarded from referrals where referred_creator_id = c_kid) = 250,
                 'referral awarded 250');
  perform assert((select coalesce(sum(amount),0) from points_ledger
                  where creator_id = c_ref and source = 'referral') = 250,
                 'ledger credited exactly once on approval');
  perform assert((select qualifying_submission_id from referrals where referred_creator_id = c_kid) = sub_kid,
                 'the paying submission is recorded on the referral');
  perform assert((select approved_at from submissions where id = sub_kid) is not null, 'approved_at stamped');

  -- idempotency: re-running the same transition must not pay twice
  update submissions set status = 'under_review' where id = sub_kid;
  update submissions set status = 'verified' where id = sub_kid;
  perform assert((select coalesce(sum(amount),0) from points_ledger
                  where creator_id = c_ref and source = 'referral') = 250,
                 'a second approval does not double pay');

  raise notice '--- constraint: points cannot exist without approval ---';
  perform expect_error(
    format('update referrals set stage=''invited'', points_awarded=250, points_awarded_at=now() where referred_creator_id=%L', c_kid),
    'points on a non-approved referral rejected by constraint');

  raise notice '--- bonus tasks ---';
  select id into t1 from tasks where cycle_id = cy and code = 'verify-handle';
  insert into task_completions (task_id, registration_id) values (t1, r_kid) returning id into tc1;
  perform assert((select amount from points_ledger where task_completion_id = tc1) = 150, 'task credited 150');

  update task_completions set revoked_at = now(), revoked_reason = 'spot check' where id = tc1;
  perform assert((select coalesce(sum(amount),0) from points_ledger where task_completion_id = tc1
                  or reverses_id in (select id from points_ledger where task_completion_id = tc1)) = 0,
                 'revocation writes the matching negative, net zero');
  perform assert((select count(*) from points_ledger where amount < 0 and source = 'task') = 1,
                 'the original row is kept, not deleted');

  raise notice '--- snapshots are append only ---';
  insert into metric_snapshots (submission_id, cycle_id, snapshot_no, views, likes, comments, shares, saves, is_final)
    values (sub_kid, cy, 1, 10000, 800, 90, 60, 50, true);
  perform assert((select round(engagement_rate, 4) from metric_snapshots where submission_id = sub_kid)
                 = round(1000::numeric/10000, 4), 'engagement rate computed');
  perform expect_error(
    format('update metric_snapshots set views = 999999 where submission_id = %L', sub_kid),
    'snapshot UPDATE blocked');
  perform expect_error(
    format('delete from metric_snapshots where submission_id = %L', sub_kid),
    'snapshot DELETE blocked');

  raise notice '--- freezes ---';
  update cycles set scoring_locked_at = now() where id = cy;
  perform expect_error(
    format('update cycles set scoring_weights = ''{"views":50,"engagement":25,"quality":15,"compliance":10}''::jsonb where id = %L', cy),
    'locked scoring weights cannot change');
  perform expect_error(
    format('update cycles set scoring_weights = ''{"views":50,"engagement":25,"quality":10,"compliance":10}''::jsonb where id = %L', cy),
    'weights that do not sum to 100 rejected');

  update prizes set published_at = now() where cycle_id = cy and label = 'Champion';
  perform expect_error(
    format('update prizes set cash_minor = 5000000 where cycle_id = %L and label = ''Champion''', cy),
    'published prize tier cannot be revised');

  raise notice '--- announcements ---';
  perform expect_error(
    format('insert into announcements (cycle_id, title, event_at, publish_at) values (%L, ''late'', now() + interval ''2 hours'', now())', cy),
    '24 hour announcement rule enforced');
  perform assert((select notify_t24_at from announcements where cycle_id = cy and title = 'Finale night')
                 = (select event_at - interval '24 hours' from announcements where cycle_id = cy and title = 'Finale night'),
                 'T-24h notification time derived');
  -- the schedule tracks the anchor
  select event_at into ts from announcements where cycle_id = cy and title = 'Finale night';
  update cycles set registration_closes = registration_closes + interval '3 days' where id = cy;
  perform assert((select event_at from announcements where cycle_id = cy and title = 'Finale night') = ts + interval '3 days',
                 're-dating the cycle shifts its announcements');
  perform assert((select event_at from announcements where cycle_id = cy and title = 'Finale night')
                 = (select finale_at from cycles where id = cy),
                 'announcement stays pinned to the finale after a re-date');
  update cycles set registration_closes = registration_closes - interval '3 days' where id = cy;

  raise notice '--- support SLA ---';
  insert into support_tickets (cycle_id, creator_id, reference, priority, subject, body)
    values (cy, c_kid, 'CLP-9001', 'critical', 'upload dead', 'stuck at 80 percent');
  select extract(epoch from (sla_due_at - created_at))/60 into v from support_tickets where reference = 'CLP-9001';
  perform assert(v = 15, 'critical ticket gets a 15 minute target');

  raise notice '--- views ---';
  perform assert((select total_points from v_season_leaderboard where creator_id = c_ref) = 250,
                 'leaderboard sums the ledger');
  perform assert((select referral_points from v_season_leaderboard where creator_id = c_ref) = 250,
                 'leaderboard breaks points down by source');
  select approved into n from v_referral_funnel where referrer_id = c_ref;
  perform assert(n = 1, 'funnel counts one approved');
  select invited into n from v_referral_funnel where referrer_id = c_ref;
  perform assert(n = 1, 'funnel invited is cumulative');

  raise notice '--- disqualification kills a pending referral ---';
  insert into creators (creator_code, full_name, email, phone, referral_code)
    values ('CLP-0004','Dq Kid','dq@test.in','+914444444444','CLIP-0004') returning id into c_other;
  insert into registrations (cycle_id, creator_id, primary_profile_url, referred_by, status, reviewed_at)
    values (cy, c_other, 'https://instagram.com/dq', c_ref, 'approved', now()) returning id into r_other;
  insert into slots (cycle_id, registration_id, brand_id) values (cy, r_other, b2);
  insert into submissions (cycle_id, registration_id, brand_id, post_url, drive_url)
    values (cy, r_other, b2, 'https://instagram.com/reel/dq', 'https://drive.google.com/dq') returning id into sub_kid;
  update submissions set status = 'disqualified', dq_reason = 'artificial_engagement', dq_at = now() where id = sub_kid;
  perform assert((select stage from referrals where referred_creator_id = c_other) = 'rejected',
                 'disqualified clip rejects the referral');
  perform assert((select coalesce(sum(amount),0) from points_ledger
                  where creator_id = c_ref and source = 'referral') = 250,
                 'disqualified referral paid nothing, total still 250');
  select not_approved into n from v_referral_funnel where referrer_id = c_ref;
  perform assert(n = 1, 'funnel shows one not approved');
  select invited into n from v_referral_funnel where referrer_id = c_ref;
  perform assert(n = 1, 'rejected referral excluded from the funnel stages');

  raise notice '';
  raise notice 'ALL RULE TESTS PASSED';
end $$;
