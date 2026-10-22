-- =============================================================
-- CLIPATHON · 008 · row level security
-- =============================================================
-- Every table gets RLS enabled. The default with RLS on and no matching
-- policy is DENY, which is the behaviour we want: a table added later
-- and forgotten here is unreachable rather than public.
--
-- Three audiences:
--   * the creator, who may read their own rows and write a narrow set
--   * the console operator, scoped by role from clipathon.has_role()
--   * service_role, used by cron jobs and edge functions, which bypasses
--     RLS entirely and is never exposed to a browser
--
-- `anon` gets nothing at all here. The public leaderboard is served
-- through a service-role edge function rather than an anon policy, so
-- nobody can enumerate creators' emails from a published key.
-- =============================================================

-- Helper: the creator row belonging to the caller.
create or replace function clipathon.my_creator_id()
returns uuid
language sql
stable
security definer
set search_path = clipathon, pg_temp
as $$
  select id from clipathon.creators where auth_user_id = auth.uid() limit 1;
$$;

-- Helper: does this registration belong to the caller?
create or replace function clipathon.owns_registration(reg uuid)
returns boolean
language sql
stable
security definer
set search_path = clipathon, pg_temp
as $$
  select exists (
    select 1 from clipathon.registrations r
    where r.id = reg and r.creator_id = clipathon.my_creator_id()
  );
$$;

alter table clipathon.admin_users        enable row level security;
alter table clipathon.cycles             enable row level security;
alter table clipathon.brands             enable row level security;
alter table clipathon.brand_assets       enable row level security;
alter table clipathon.sessions           enable row level security;
alter table clipathon.announcements      enable row level security;
alter table clipathon.creators           enable row level security;
alter table clipathon.ambassadors        enable row level security;
alter table clipathon.registrations      enable row level security;
alter table clipathon.creator_accounts   enable row level security;
alter table clipathon.referrals          enable row level security;
alter table clipathon.slots              enable row level security;
alter table clipathon.submissions        enable row level security;
alter table clipathon.metric_snapshots   enable row level security;
alter table clipathon.scores             enable row level security;
alter table clipathon.tasks              enable row level security;
alter table clipathon.task_completions   enable row level security;
alter table clipathon.seasons            enable row level security;
alter table clipathon.points_ledger      enable row level security;
alter table clipathon.season_standings   enable row level security;
alter table clipathon.prizes             enable row level security;
alter table clipathon.prize_awards       enable row level security;
alter table clipathon.certificates       enable row level security;
alter table clipathon.payouts            enable row level security;
alter table clipathon.support_tickets    enable row level security;
alter table clipathon.ticket_messages    enable row level security;
alter table clipathon.audit_log          enable row level security;

-- -------------------------------------------------------------
-- Console operators
-- -------------------------------------------------------------
create policy admin_read_self on clipathon.admin_users
  for select to authenticated using (user_id = auth.uid() or clipathon.has_role(array['owner']::clipathon.admin_role[]));
create policy admin_manage on clipathon.admin_users
  for all to authenticated
  using (clipathon.has_role(array['owner']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['owner']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Event configuration: readable by any signed-in creator once it is no
-- longer a draft, writable by the roles that own it.
-- -------------------------------------------------------------
create policy cycles_read on clipathon.cycles
  for select to authenticated using (status <> 'draft' or clipathon.is_admin());
create policy cycles_write on clipathon.cycles
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- Briefs are invisible until the reveal. That is the "no head start"
-- rule from the playbook, and it belongs in the database rather than in
-- a client-side conditional that anyone can defeat with a fetch.
create policy brands_read on clipathon.brands
  for select to authenticated using (
    clipathon.is_admin()
    or exists (
      select 1 from clipathon.cycles c
      where c.id = brands.cycle_id
        and c.status in ('reveal','slot_selection','creation','tracking','finale','closed','archived')
    )
  );
create policy brands_write on clipathon.brands
  for all to authenticated
  using (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]));

create policy brand_assets_read on clipathon.brand_assets
  for select to authenticated using (
    clipathon.is_admin()
    or exists (
      select 1 from clipathon.brands b join clipathon.cycles c on c.id = b.cycle_id
      where b.id = brand_assets.brand_id
        and c.status in ('reveal','slot_selection','creation','tracking','finale','closed','archived')
    )
  );
create policy brand_assets_write on clipathon.brand_assets
  for all to authenticated
  using (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','partnerships']::clipathon.admin_role[]));

create policy sessions_read on clipathon.sessions
  for select to authenticated using (true);
create policy sessions_write on clipathon.sessions
  for all to authenticated
  using (clipathon.has_role(array['ops','partnerships','marketing']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','partnerships','marketing']::clipathon.admin_role[]));

-- An announcement is visible once its publish_at has passed. Scheduling
-- one in advance therefore cannot leak it early.
create policy announcements_read on clipathon.announcements
  for select to authenticated using (publish_at <= now() or clipathon.is_admin());
create policy announcements_write on clipathon.announcements
  for all to authenticated
  using (clipathon.has_role(array['ops','marketing']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','marketing']::clipathon.admin_role[]));

create policy tasks_read on clipathon.tasks
  for select to authenticated using (is_active or clipathon.is_admin());
create policy tasks_write on clipathon.tasks
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

create policy seasons_read on clipathon.seasons
  for select to authenticated using (true);
create policy seasons_write on clipathon.seasons
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- Prizes are readable once published, editable only by finance and only
-- while unpublished. 009 adds the immutability trigger on top.
create policy prizes_read on clipathon.prizes
  for select to authenticated using (published_at is not null or clipathon.is_admin());
create policy prizes_write on clipathon.prizes
  for all to authenticated
  using (clipathon.has_role(array['finance']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['finance']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- The creator's own data
-- -------------------------------------------------------------
create policy creators_read_self on clipathon.creators
  for select to authenticated
  using (auth_user_id = auth.uid() or clipathon.is_admin());
-- A creator may edit presentation, not identity. Name, email and phone
-- are what verification was performed against, so they change through
-- support, not through the profile form.
create policy creators_update_self on clipathon.creators
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
create policy creators_admin on clipathon.creators
  for all to authenticated
  using (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]));

create policy registrations_read_self on clipathon.registrations
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy registrations_admin on clipathon.registrations
  for all to authenticated
  using (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]));

create policy accounts_read_self on clipathon.creator_accounts
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy accounts_write_self on clipathon.creator_accounts
  for all to authenticated
  using (creator_id = clipathon.my_creator_id())
  with check (creator_id = clipathon.my_creator_id());
create policy accounts_admin on clipathon.creator_accounts
  for all to authenticated
  using (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]));

-- A referrer sees their own pipeline; the person referred sees the row
-- that names them. Neither can write it: stages are advanced by trigger.
create policy referrals_read on clipathon.referrals
  for select to authenticated
  using (
    referrer_id = clipathon.my_creator_id()
    or referred_creator_id = clipathon.my_creator_id()
    or clipathon.is_admin()
  );
create policy referrals_admin on clipathon.referrals
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Slots
-- -------------------------------------------------------------
-- A creator inserts their own slot, once, and only while the window is
-- genuinely open. They can never update or delete it: "final once
-- confirmed" is enforced by the absence of those policies, not by a
-- disabled button.
create policy slots_read on clipathon.slots
  for select to authenticated
  using (clipathon.owns_registration(registration_id) or clipathon.is_admin());
create policy slots_insert_self on clipathon.slots
  for insert to authenticated
  with check (
    clipathon.owns_registration(registration_id)
    and exists (
      select 1 from clipathon.cycles c
      where c.id = slots.cycle_id
        and c.status = 'slot_selection'
        and now() between c.slots_open_at and c.slots_close_at
    )
    and exists (
      select 1 from clipathon.registrations r
      where r.id = slots.registration_id and r.status = 'approved'
    )
    -- Verified account required before a slot can be taken.
    and exists (
      select 1 from clipathon.creator_accounts a
      where a.creator_id = clipathon.my_creator_id() and a.status = 'verified'
    )
  );
create policy slots_admin on clipathon.slots
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Submissions
-- -------------------------------------------------------------
-- The creator may write their own entry only before the cutoff, and
-- only while it is still in a pre-review state. Once QC has it, it is
-- read only to them.
create policy submissions_read_self on clipathon.submissions
  for select to authenticated
  using (clipathon.owns_registration(registration_id) or clipathon.is_admin());
create policy submissions_insert_self on clipathon.submissions
  for insert to authenticated
  with check (
    clipathon.owns_registration(registration_id)
    and exists (
      select 1 from clipathon.cycles c
      where c.id = submissions.cycle_id and now() < c.submission_cutoff_at
    )
  );
create policy submissions_update_self on clipathon.submissions
  for update to authenticated
  using (
    clipathon.owns_registration(registration_id)
    and status in ('not_started','link_submitted','file_uploaded','complete','rejected')
    and exists (
      select 1 from clipathon.cycles c
      where c.id = submissions.cycle_id and now() < c.submission_cutoff_at
    )
  )
  with check (clipathon.owns_registration(registration_id));
create policy submissions_admin on clipathon.submissions
  for all to authenticated
  using (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','reviewer']::clipathon.admin_role[]));

-- Snapshots and scores: creators read their own, nobody but ops writes,
-- and scores only become visible to the creator once locked. An
-- unlocked score is a work in progress and showing it would guarantee
-- an argument.
create policy snapshots_read on clipathon.metric_snapshots
  for select to authenticated
  using (
    clipathon.is_admin()
    or exists (
      select 1 from clipathon.submissions s
      where s.id = metric_snapshots.submission_id and clipathon.owns_registration(s.registration_id)
    )
  );
create policy snapshots_write on clipathon.metric_snapshots
  for insert to authenticated
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

create policy scores_read on clipathon.scores
  for select to authenticated
  using (
    clipathon.is_admin()
    or (locked_at is not null and exists (
      select 1 from clipathon.submissions s
      where s.id = scores.submission_id and clipathon.owns_registration(s.registration_id)
    ))
  );
create policy scores_write on clipathon.scores
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Points and standings
-- -------------------------------------------------------------
-- Task completions: a creator may claim a manual task for themselves.
-- Automatic ones are inserted by triggers running as the table owner,
-- and revocation is admin only.
create policy completions_read on clipathon.task_completions
  for select to authenticated
  using (clipathon.owns_registration(registration_id) or clipathon.is_admin());
create policy completions_claim on clipathon.task_completions
  for insert to authenticated
  with check (
    clipathon.owns_registration(registration_id)
    and exists (select 1 from clipathon.tasks t where t.id = task_completions.task_id and not t.is_auto and t.is_active)
  );
create policy completions_admin on clipathon.task_completions
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- The ledger is readable by its owner and by admins, and writable by
-- nobody through the API. Every row is written by a trigger or by
-- service_role. This is what makes the leaderboard trustworthy.
create policy points_read on clipathon.points_ledger
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy points_admin_adjust on clipathon.points_ledger
  for insert to authenticated
  with check (
    clipathon.has_role(array['ops']::clipathon.admin_role[])
    and source = 'adjustment'
  );

create policy standings_read on clipathon.season_standings
  for select to authenticated using (true);
create policy standings_write on clipathon.season_standings
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Awards, certificates, payouts
-- -------------------------------------------------------------
create policy awards_read on clipathon.prize_awards
  for select to authenticated
  using (announced_at is not null or creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy awards_write on clipathon.prize_awards
  for all to authenticated
  using (clipathon.has_role(array['ops','finance']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops','finance']::clipathon.admin_role[]));

create policy certificates_read on clipathon.certificates
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy certificates_write on clipathon.certificates
  for all to authenticated
  using (clipathon.has_role(array['ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['ops']::clipathon.admin_role[]));

-- Payouts: a winner sees their own, finance manages them. Note there is
-- no creator UPDATE policy, so bank details are submitted through a
-- service-role function that validates them, not written directly.
create policy payouts_read_self on clipathon.payouts
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy payouts_admin on clipathon.payouts
  for all to authenticated
  using (clipathon.has_role(array['finance']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['finance']::clipathon.admin_role[]));

-- -------------------------------------------------------------
-- Support
-- -------------------------------------------------------------
create policy tickets_read_self on clipathon.support_tickets
  for select to authenticated
  using (creator_id = clipathon.my_creator_id() or clipathon.is_admin());
create policy tickets_create_self on clipathon.support_tickets
  for insert to authenticated
  with check (creator_id = clipathon.my_creator_id());
create policy tickets_admin on clipathon.support_tickets
  for all to authenticated
  using (clipathon.is_admin())
  with check (clipathon.is_admin());

-- Internal staff notes are filtered out for the creator by the
-- is_internal clause; the creator sees only the public thread.
create policy messages_read on clipathon.ticket_messages
  for select to authenticated
  using (
    clipathon.is_admin()
    or (not is_internal and exists (
      select 1 from clipathon.support_tickets t
      where t.id = ticket_messages.ticket_id and t.creator_id = clipathon.my_creator_id()
    ))
  );
create policy messages_write_self on clipathon.ticket_messages
  for insert to authenticated
  with check (
    (not is_internal and exists (
      select 1 from clipathon.support_tickets t
      where t.id = ticket_messages.ticket_id and t.creator_id = clipathon.my_creator_id()
    ))
    or clipathon.is_admin()
  );

-- -------------------------------------------------------------
-- Ambassadors and audit
-- -------------------------------------------------------------
create policy ambassadors_read on clipathon.ambassadors
  for select to authenticated
  using (clipathon.is_admin() or creator_id = clipathon.my_creator_id());
create policy ambassadors_write on clipathon.ambassadors
  for all to authenticated
  using (clipathon.has_role(array['marketing','ops']::clipathon.admin_role[]))
  with check (clipathon.has_role(array['marketing','ops']::clipathon.admin_role[]));

-- Read only, even for owners. The trail is written by triggers and by
-- service_role, and an audit log that operators can edit is worthless.
create policy audit_read on clipathon.audit_log
  for select to authenticated using (clipathon.is_admin());
