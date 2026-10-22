-- 023 · Clients approve their own clips. Silence for 48 hours is a yes.
--
-- Until now every submission waited for Clipency to approve it in the
-- console. On a campaign that has a client attached, a new submission now
-- goes to that client's dashboard (Clips Feed, "Awaiting approval"), where
-- they approve or reject it. If nobody acts within the campaign's review
-- window (48 hours by default) it is approved automatically.
--
-- * campaigns.client_review (default on) and client_review_hours (default 48)
--   switch it per campaign. A campaign with no client attached keeps the old
--   flow: Clipency approves, nothing auto-approves.
-- * clip_submissions.review_due_at is stamped on insert (and for anything
--   already pending when this ran: now + window, so no backlog clip
--   auto-approves without the client getting their full window).
--   review_source records who decided: client, auto, or null for Clipency.
-- * client_review_clip(id, approve, reason) is the client's action. Approving
--   runs the same path as the console (status approved, earnings computed by
--   cs_calc_earning and cx_settle_creator_campaign). Rejecting needs a reason
--   and the creator sees it as the rejection reason.
-- * cx_auto_approve_due() runs every 15 minutes from pg_cron and approves
--   what is overdue, on active campaigns only. A paused campaign's clips wait.
-- * Clipency can still approve or reject from the console at any time.
-- * client_dashboard_data() gains a 'pending' list (no money fields) and
--   returns the clips the client rejected, for the Rejected tab.

alter table public.campaigns
  add column if not exists client_review boolean not null default true,
  add column if not exists client_review_hours integer not null default 48;
do $c$ begin
  alter table public.campaigns add constraint campaigns_client_review_hours_chk
    check (client_review_hours between 1 and 168);
exception when duplicate_object then null; end $c$;

alter table public.clip_submissions
  add column if not exists review_due_at timestamptz,
  add column if not exists review_source text;
do $c$ begin
  alter table public.clip_submissions add constraint clip_submissions_review_source_chk
    check (review_source is null or review_source in ('client','auto'));
exception when duplicate_object then null; end $c$;
create index if not exists idx_cs_review_due on public.clip_submissions (review_due_at) where status = 'pending';

-- Client review is on for a campaign when the switch is on and a client can see it.
create or replace function public.cx_client_review_on(p_campaign text)
returns boolean language sql stable security definer set search_path = public as $f$
  select coalesce((
    select c.client_review
       and (c.client_user_id is not null
            or exists (select 1 from public.campaign_clients cc where cc.campaign_id = c.id))
      from public.campaigns c where c.id::text = p_campaign), false)
$f$;

create or replace function public.cx_stamp_review_due()
returns trigger language plpgsql security definer set search_path = public as $f$
declare h int;
begin
  new.review_source := null;
  new.review_due_at := null;
  if new.status = 'pending' and public.cx_client_review_on(new.campaign_id) then
    select client_review_hours into h from public.campaigns where id::text = new.campaign_id;
    new.review_due_at := now() + make_interval(hours => coalesce(h, 48));
  end if;
  return new;
end $f$;

drop trigger if exists trg_cx_stamp_review_due on public.clip_submissions;
create trigger trg_cx_stamp_review_due
  before insert on public.clip_submissions
  for each row execute function public.cx_stamp_review_due();

-- Creators cannot move their own deadline or claim a client decision.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cs_freeze_metrics()'::regprocedure);
  n := replace(d, $x$  new.platform_post_id     := old.platform_post_id;$x$,
$x$  new.platform_post_id     := old.platform_post_id;
  new.review_due_at        := old.review_due_at;
  new.review_source        := old.review_source;$x$);
  if n = d then raise exception 'cs_freeze_metrics: review fields not frozen (022 not applied?)'; end if;
  execute n;
end $mig$;

-- Backlog: everything pending on a client-reviewed campaign gets a full window
-- from now. trusted_write, or cs_freeze_metrics (above) silently undoes it.
do $mig$
begin
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions s
     set review_due_at = now() + make_interval(hours => c.client_review_hours)
    from public.campaigns c
   where c.id::text = s.campaign_id and s.status = 'pending' and s.review_due_at is null
     and public.cx_client_review_on(s.campaign_id);
  perform set_config('clipency.trusted_write', '0', true);
end $mig$;

create or replace function public.client_review_clip(p_submission_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare uid uuid := auth.uid(); s record; camp record; now_status text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not cx_is_client() then raise exception 'not a client account'; end if;
  if p_approve is null then raise exception 'approve or reject?'; end if;
  if not p_approve and coalesce(btrim(p_reason), '') = '' then raise exception 'a reason is required to reject a clip'; end if;
  if length(coalesce(p_reason, '')) > 2000 then raise exception 'reason is too long'; end if;

  select * into s from public.clip_submissions where id = p_submission_id for update;
  if not found then raise exception 'no such clip'; end if;
  select * into camp from public.campaigns c where c.id::text = s.campaign_id;
  if not found then raise exception 'clip is not on a campaign'; end if;
  if not exists (select 1 from public.campaign_clients cc where cc.campaign_id = camp.id and cc.client_user_id = uid)
     and camp.client_user_id is distinct from uid then
    raise exception 'this campaign is not on your dashboard' using errcode = '42501';
  end if;

  if s.status <> 'pending' then
    if (p_approve and s.status = 'approved') or (not p_approve and s.status = 'rejected') then
      return jsonb_build_object('status', s.status, 'already', true, 'source', s.review_source);
    end if;
    raise exception 'this clip was already %', case s.status when 'approved' then 'approved' when 'rejected' then 'rejected' else s.status end;
  end if;
  if not public.cx_client_review_on(s.campaign_id) then
    raise exception 'Clipency reviews the clips on this campaign';
  end if;

  perform set_config('clipency.trusted_write', '1', true);
  if p_approve then
    update public.clip_submissions
       set status = 'approved', earning_status = 'approved', review_source = 'client',
           reviewed_by = uid, reviewed_at = now(), updated_at = now()
     where id = s.id;
  else
    update public.clip_submissions
       set status = 'rejected', earning_status = 'rejected', review_source = 'client',
           rejection_reason = 'Rejected by the client: ' || btrim(p_reason),
           reviewed_by = uid, reviewed_at = now(), updated_at = now()
     where id = s.id;
  end if;
  perform set_config('clipency.trusted_write', '0', true);

  select status into now_status from public.clip_submissions where id = s.id;
  if now_status is distinct from (case when p_approve then 'approved' else 'rejected' end) then
    raise exception 'the clip could not be updated (status is still %)', now_status;
  end if;
  return jsonb_build_object('status', now_status, 'source', 'client');
end $f$;

revoke all on function public.client_review_clip(uuid, boolean, text) from public, anon;
grant execute on function public.client_review_clip(uuid, boolean, text) to authenticated;

create or replace function public.cx_auto_approve_due()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare r record; ok int := 0; skipped int := 0; stamped int;
begin
  -- A client attached after submission: start the window now.
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions s
     set review_due_at = now() + make_interval(hours => c.client_review_hours)
    from public.campaigns c
   where c.id::text = s.campaign_id and s.status = 'pending' and s.review_due_at is null
     and public.cx_client_review_on(s.campaign_id);
  get diagnostics stamped = row_count;
  perform set_config('clipency.trusted_write', '0', true);

  for r in
    select s.id from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
     where s.status = 'pending' and s.review_due_at <= now()
       and c.status = 'active' and public.cx_client_review_on(s.campaign_id)
     order by s.created_at
     limit 500
  loop
    begin
      perform set_config('clipency.trusted_write', '1', true);
      update public.clip_submissions
         set status = 'approved', earning_status = 'approved', review_source = 'auto',
             reviewed_at = now(), updated_at = now()
       where id = r.id and status = 'pending';
      perform set_config('clipency.trusted_write', '0', true);
      ok := ok + 1;
    exception when others then
      perform set_config('clipency.trusted_write', '0', true);
      skipped := skipped + 1;
      raise warning 'cx_auto_approve_due: % skipped: %', r.id, sqlerrm;
    end;
  end loop;
  return jsonb_build_object('approved', ok, 'skipped', skipped, 'stamped', stamped);
end $f$;

revoke all on function public.cx_auto_approve_due() from public, anon, authenticated;

do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'cx_auto_approve_due';
  perform cron.schedule('cx_auto_approve_due', '*/15 * * * *', 'select public.cx_auto_approve_due();');
end $cron$;

-- Dashboard payload: pending list, and client-rejected clips for the Rejected tab.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.client_dashboard_data()'::regprocedure);

  n := replace(d, $x$               'created_at', s.created_at,
               'flagged_at', s.flagged_at,$x$,
$x$               'created_at', s.created_at,
               'flagged_at', s.flagged_at,
               'review', case when s.review_source is not null then jsonb_build_object(
                          'source', s.review_source,
                          'at', s.reviewed_at,
                          'by_me', (s.reviewed_by = uid),
                          'reason', case when s.review_source = 'client' and s.status = 'rejected'
                                         then regexp_replace(coalesce(s.rejection_reason,''), '^Rejected by the client: ', '')
                                    end) end,$x$);

  n := replace(n, $x$      where (s.status in ('approved','flagged')
             or exists (select 1 from public.clip_flags fx where fx.submission_id = s.id))$x$,
$x$      where (s.status in ('approved','flagged')
             or exists (select 1 from public.clip_flags fx where fx.submission_id = s.id)
             or (s.status = 'rejected' and s.review_source = 'client'))$x$);

  n := replace(n, $x$    'fx', public.cx_fx_rates_public(),$x$,
$x$    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'campaign_id', s.campaign_id, 'campaign_title', s.campaign_title,
               'platform', s.platform, 'handle', s.handle, 'clip_url', s.clip_url,
               'created_at', s.created_at, 'review_due_at', s.review_due_at,
               'auto_approve_paused', (c.status is distinct from 'active'))
             order by s.review_due_at nulls last, s.created_at)
      from public.clip_submissions s
      join public.campaigns c on c.id::text = s.campaign_id
      where s.status = 'pending'
        and public.cx_client_review_on(s.campaign_id)
        and (exists (select 1 from public.campaign_clients cc
                      where cc.campaign_id = c.id and cc.client_user_id = uid)
             or c.client_user_id = uid)), '[]'::jsonb),

    'fx', public.cx_fx_rates_public(),$x$);

  if position('''review'', case when' in n) = 0
     or position('s.review_source = ''client'')' in n) = 0
     or position('''pending'', coalesce' in n) = 0 then
    raise exception 'client_dashboard_data: not every replacement applied';
  end if;
  execute n;
end $mig$;

-- Internal helpers are not API endpoints. (Applied as 023c.)
revoke all on function public.cx_guard_clip_url() from public, anon, authenticated;
revoke all on function public.cx_stamp_review_due() from public, anon, authenticated;
revoke all on function public.cx_client_review_on(text) from public, anon, authenticated;
