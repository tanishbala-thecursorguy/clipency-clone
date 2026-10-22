-- 039: switch the new features on — live updates, scheduled jobs, image storage.
-- Add-only: the new tables join Realtime, one new bucket, one new upload rule for
-- that bucket, and 3 new jobs. Existing tables, buckets and the 8 existing jobs are
-- not changed.
--
-- * Realtime: appeals, appeal_messages, campaign_chats, campaign_chat_messages join
--   the supabase_realtime publication. Row-level security (037/038) decides who
--   receives what, so a message only reaches people who can read it.
-- * Storage: the 'appeal-attachments' bucket (screenshots in appeals and images in
--   group chats; the dashboard uses public URLs). Images only, 3 MB max, and you can
--   only upload into a thread you're part of.
-- * Scheduled jobs (pg_cron), all new:
--     cx_gc_purge        every 15 min  delete group chat messages older than 12h
--     cx_appeal_sweep    hourly        delete settled appeals / appeals whose clip was approved
--     cx_message_emails  every 5 min   send chat emails + delete images of settled chats
-- * Edge functions are called with the service_role key from Vault, like 024 does.
--
-- Safe to re-run.

begin;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['appeals','appeal_messages','campaign_chats','campaign_chat_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('appeal-attachments', 'appeal-attachments', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- who may upload where: '<appeal id>/…' for an appeal you're in, 'gc-<campaign id>/…' for a chat you can read
create or replace function public.cx_attachment_folder_ok(p_folder text) returns boolean
language plpgsql stable security definer set search_path = public as $f$
begin
  if p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.cx_appeal_visible(p_folder::uuid);
  elsif p_folder ~* '^gc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.cx_gc_can_read(substr(p_folder, 4)::uuid);
  end if;
  return false;
end $f$;
revoke all on function public.cx_attachment_folder_ok(text) from public, anon;
grant execute on function public.cx_attachment_folder_ok(text) to authenticated;

drop policy if exists cx_attachments_upload on storage.objects;
create policy cx_attachments_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'appeal-attachments' and public.cx_attachment_folder_ok((storage.foldername(name))[1]));

-- images whose conversation is gone (settled appeal) or older than the chat's 12 hours.
-- The message-emails function deletes them through the Storage API.
create or replace function public.cx_attachment_orphans(p_limit int default 500) returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select coalesce(jsonb_agg(o.name), '[]'::jsonb) from (
    select o.name from storage.objects o
     where o.bucket_id = 'appeal-attachments'
       and o.created_at < now() - interval '10 minutes'          -- leave uploads in flight alone
       and case
             when o.name ~* '^gc-' then o.created_at < now() - make_interval(hours => public.cx_gc_ttl_hours())
             when o.name ~* '^[0-9a-f-]{36}/' then not exists (select 1 from public.appeals a where a.id::text = split_part(o.name, '/', 1))
             else false end
     order by o.created_at limit p_limit) o
$$;
revoke all on function public.cx_attachment_orphans(int) from public, anon, authenticated;
grant execute on function public.cx_attachment_orphans(int) to service_role;

-- ---------- message emails: what the sender reads and marks ----------
create or replace function public.cx_message_email_batch(p_limit int default 50) returns jsonb
language sql security definer set search_path = public as $$
  with picked as (
    select id from public.cx_message_outbox
     where (status = 'queued' and updated_at < now() - interval '2 minutes')     -- let a burst of messages merge into one email
        or (status = 'sending' and updated_at < now() - interval '15 minutes')  -- a sender that died mid-way
     order by created_at limit p_limit for update skip locked),
  taken as (
    update public.cx_message_outbox o set status = 'sending', attempts = o.attempts + 1, updated_at = now()
      from picked where o.id = picked.id
    returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'to', to_email, 'subject', subject, 'body', body, 'template', template,
                                               'ref_id', ref_id, 'messages', messages) order by created_at), '[]'::jsonb)
    from taken
$$;

create or replace function public.cx_message_email_mark(p_id bigint, p_ok boolean, p_error text default null) returns void
language plpgsql security definer set search_path = public as $f$
begin
  update public.cx_message_outbox
     set status = case when p_ok then 'sent' when attempts >= 5 then 'failed' else 'queued' end,
         sent_at = case when p_ok then now() end, last_error = left(p_error, 500), updated_at = now()
   where id = p_id;
end $f$;

revoke all on function public.cx_message_email_batch(int), public.cx_message_email_mark(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.cx_message_email_batch(int), public.cx_message_email_mark(bigint, boolean, text) to service_role;

-- ---------- calling edge functions ----------
create or replace function public.cx_edge_kick(p_function text, p_body jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public, extensions, vault as $f$
declare key text; req bigint;
begin
  select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if key is null then raise warning 'cx_edge_kick(%): service_role_key missing', p_function; return null; end if;
  select net.http_post(
    url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := coalesce(p_body, '{}'::jsonb),
    timeout_milliseconds := 60000) into req;
  return req;
end $f$;
revoke all on function public.cx_edge_kick(text, jsonb) from public, anon, authenticated;

create or replace function public.cx_message_email_kick() returns bigint
language plpgsql security definer set search_path = public as $f$
begin
  -- nothing to send and nothing to clean up: don't wake the function
  if not exists (select 1 from public.cx_message_outbox where status in ('queued','sending'))
     and public.cx_attachment_orphans(1) = '[]'::jsonb then return null; end if;
  return public.cx_edge_kick('message-emails', jsonb_build_object('mode', 'send'));
end $f$;
revoke all on function public.cx_message_email_kick() from public, anon, authenticated;

-- appeals whose clip isn't rejected any more, and old sent emails
create or replace function public.cx_appeal_sweep() returns jsonb
language plpgsql security definer set search_path = public as $f$
declare a int; e int;
begin
  delete from public.appeals x where x.kind = 'clip'
     and (x.status <> 'open' or not exists (select 1 from public.clip_submissions s where s.id = x.submission_id and s.status in ('rejected','flagged')));
  get diagnostics a = row_count;
  delete from public.cx_message_outbox where status in ('sent','failed','skipped') and updated_at < now() - interval '30 days';
  get diagnostics e = row_count;
  return jsonb_build_object('appeals_deleted', a, 'emails_cleared', e);
end $f$;
revoke all on function public.cx_appeal_sweep() from public, anon, authenticated;

-- ---------- schedule ----------
do $cron$
declare j text;
begin
  foreach j in array array['cx_gc_purge','cx_appeal_sweep','cx_message_emails'] loop
    perform cron.unschedule(jobid) from cron.job where jobname = j;
  end loop;
  perform cron.schedule('cx_gc_purge',       '*/15 * * * *', 'select public.cx_gc_purge();');
  perform cron.schedule('cx_appeal_sweep',   '23 * * * *',   'select public.cx_appeal_sweep();');
  perform cron.schedule('cx_message_emails', '*/5 * * * *',  'select public.cx_message_email_kick();');
end $cron$;

commit;
