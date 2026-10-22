-- 022 · One reel, one submission, whatever link format it was copied in.
--
-- The only guard was a unique index on the raw clip_url string. The same reel
-- copied from the Instagram app (?igsh=...), from a browser
-- (?utm_source=ig_web_copy_link&stkn=...), from WhatsApp, or YouTube with a
-- different ?si= token is a different string, so it went straight through.
-- On 28 Sep that had produced 4 reels approved twice (DdoydC2tfcZ,
-- DdqPfgcxC6C, DdTDNcBvjhP, yDBXX3WNsIA) and 5 more pending second copies of
-- reels already approved.
--
-- 1. cx_clip_key(url): the post identity. ig:<shortcode>, yt:<video id>,
--    tt:<video id>; anything else falls back to host + path without the query.
-- 2. clip_submissions.clip_key, kept by trigger, indexed.
-- 3. trg_cx_guard_clip_url: a link that is not a single post (a profile, a
--    reels tab, a random site) is refused at submission, and a second live
--    submission of the same post is refused, on insert and whenever a row is
--    re-opened or approved. Rejected rows do not count, so a creator can
--    resubmit after a rejection. An advisory lock per key closes the race
--    between two simultaneous submits.
-- 4. cs_freeze_metrics also freezes the identity of a submission (url,
--    campaign, account, handle, review fields) against the creator's own
--    update rights. The cs_update policy let a creator rewrite clip_url on an
--    already approved clip; no page did it, but the database allowed it.
-- 5. The 5 pending second copies are rejected as duplicates. No money moves.
--    The 4 double approvals are left as they are for Ayush to decide.

create or replace function public.cx_clip_key(p_url text)
returns text language plpgsql immutable set search_path = public as $f$
declare u text := btrim(coalesce(p_url, '')); host text; path text; m text;
begin
  if u = '' then return null; end if;
  host := lower(substring(u from '(?i)^https?://([^/?#]+)'));
  if host is null then return null; end if;
  host := regexp_replace(host, '^(www\.|m\.)', '');
  path := coalesce(substring(u from '(?i)^https?://[^/?#]+([^?#]*)'), '');

  if host = 'instagram.com' then
    if path !~* '^/share/' then
      m := substring(path from '^/(?:[A-Za-z0-9_.]+/)?(?:reels?|p|tv)/([A-Za-z0-9_-]+)');
      if m is not null then return 'ig:' || m; end if;
    end if;
  elsif host = 'youtu.be' then
    m := substring(path from '^/([A-Za-z0-9_-]{6,})');
    if m is not null then return 'yt:' || m; end if;
  elsif host = 'youtube.com' or host like '%.youtube.com' then
    m := substring(path from '^/(?:shorts|live|embed|v)/([A-Za-z0-9_-]{6,})');
    if m is null and path ~ '^/watch' then m := substring(u from '[?&]v=([A-Za-z0-9_-]{6,})'); end if;
    if m is not null then return 'yt:' || m; end if;
  elsif host = 'tiktok.com' or host like '%.tiktok.com' then
    m := substring(path from '/(?:video|photo)/([0-9]+)');
    if m is not null then return 'tt:' || m; end if;
  end if;
  return 'url:' || host || regexp_replace(path, '/+$', '');
end $f$;

-- A link to one post: something the metrics fetcher can read and a client
-- can open to see the clip. TikTok short links (vm./vt./tiktok.com/t/) are
-- accepted because the fetcher follows them.
create or replace function public.cx_is_post_url(p_url text)
returns boolean language sql immutable set search_path = public as $f$
  select coalesce(
    public.cx_clip_key(p_url) ~ '^(ig|yt|tt):'
    or public.cx_clip_key(p_url) ~* '^url:(vm\.tiktok\.com|vt\.tiktok\.com)/[A-Za-z0-9]+$'
    or public.cx_clip_key(p_url) ~* '^url:tiktok\.com/t/[A-Za-z0-9]+$', false)
$f$;

alter table public.clip_submissions add column if not exists clip_key text;
update public.clip_submissions set clip_key = public.cx_clip_key(clip_url)
 where clip_key is distinct from public.cx_clip_key(clip_url);
create index if not exists idx_clip_submissions_clip_key on public.clip_submissions (clip_key);

create or replace function public.cx_guard_clip_url()
returns trigger language plpgsql security definer set search_path = public as $f$
declare need_check boolean; trusted boolean;
begin
  new.clip_url := btrim(new.clip_url);
  new.clip_key := public.cx_clip_key(new.clip_url);
  trusted := auth.role() = 'service_role' or public.cx_is_staff()
             or coalesce(current_setting('clipency.trusted_write', true), '') = '1';

  if tg_op = 'INSERT' and not trusted and not public.cx_is_post_url(new.clip_url) then
    raise exception 'That link is not a single post. Paste the link to the reel, short or video itself (it has /reel/, /shorts/ or /video/ in it), not a profile or another page.'
      using errcode = '22023';
  end if;

  need_check := tg_op = 'INSERT'
             or new.clip_url is distinct from old.clip_url
             or (old.status = 'rejected' and new.status is distinct from 'rejected')
             or (new.status = 'approved' and old.status is distinct from 'approved');

  if need_check and new.status is distinct from 'rejected' and new.clip_key is not null then
    perform pg_advisory_xact_lock(hashtext('cx_clip_key:' || new.clip_key));
    if exists (select 1 from public.clip_submissions x
                where x.clip_key = new.clip_key
                  and x.status is distinct from 'rejected'
                  and x.id <> new.id) then
      raise exception 'This clip has already been submitted. Each post can only be submitted once, even if the link was copied from a different app.'
        using errcode = '23505';
    end if;
  end if;
  return new;
end $f$;

drop trigger if exists trg_cx_guard_clip_url on public.clip_submissions;
create trigger trg_cx_guard_clip_url
  before insert or update of clip_url, status on public.clip_submissions
  for each row execute function public.cx_guard_clip_url();

-- Identity freeze for non-staff updates.
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cs_freeze_metrics()'::regprocedure);
  n := replace(d, $x$  new.metrics_error    := old.metrics_error;$x$,
$x$  new.metrics_error    := old.metrics_error;
  new.clip_url             := old.clip_url;
  new.campaign_id          := old.campaign_id;
  new.campaign_title       := old.campaign_title;
  new.platform             := old.platform;
  new.handle               := old.handle;
  new.connected_account_id := old.connected_account_id;
  new.user_id              := old.user_id;
  new.created_at           := old.created_at;
  new.reviewed_by          := old.reviewed_by;
  new.reviewed_at          := old.reviewed_at;
  new.rejection_reason     := old.rejection_reason;
  new.flagged_at           := old.flagged_at;
  new.platform_post_id     := old.platform_post_id;$x$);
  if n = d then raise exception 'cs_freeze_metrics: identity freeze not applied'; end if;
  execute n;
end $mig$;

-- Pending second copies of reels already approved.
do $mig$
declare n int;
begin
  perform set_config('clipency.trusted_write', '1', true);
  update public.clip_submissions p
     set status = 'rejected', earning_status = 'rejected',
         rejection_reason = 'Duplicate: this post was already submitted and approved.',
         reviewed_at = now(), updated_at = now()
   where p.status = 'pending'
     and p.clip_key is not null
     and exists (select 1 from public.clip_submissions a
                  where a.clip_key = p.clip_key and a.id <> p.id and a.status in ('approved','flagged'));
  get diagnostics n = row_count;
  perform set_config('clipency.trusted_write', '0', true);
  if n <> 5 then raise exception 'expected 5 pending duplicates, found %', n; end if;
end $mig$;
