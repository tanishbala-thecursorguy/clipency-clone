-- 042: ROLL BACK the features added in 036-041 (owner's request 2026-10-24, to take load
-- off the Nano database). Removes ONLY objects Clipency's new features added. No existing
-- table, row, function, trigger or policy from before 2026-10-22 is touched.
-- Kept on purpose: 035 (24h review window + 15-char reject reason) — existing behaviour now.
-- Everything here can be reinstalled later from 036-041.

begin;

-- scheduled jobs (stop first, so nothing calls the functions below)
do $cron$
declare j text;
begin
  foreach j in array array['cx_gc_purge','cx_appeal_sweep','cx_message_emails','cx_lead_welcome'] loop
    perform cron.unschedule(jobid) from cron.job where jobname = j;
  end loop;
end $cron$;

-- storage: the upload rule
drop policy if exists cx_attachments_upload on storage.objects;
-- (the empty appeal-attachments bucket stays: Supabase only allows removing it through the Storage API)

-- access rules on the new tables (they call the functions below)
drop policy if exists appeals_read on public.appeals;
drop policy if exists appeal_messages_read on public.appeal_messages;
drop policy if exists campaign_chats_read on public.campaign_chats;
drop policy if exists campaign_chat_messages_read on public.campaign_chat_messages;
drop policy if exists creator_types_own on public.creator_types;
drop policy if exists cx_lead_outreach_staff on public.cx_lead_outreach;

-- functions (RPCs and helpers)
drop function if exists public.cx_lead_welcome_kick(), public.cx_lead_outreach_mark(uuid, text, text, text), public.cx_lead_outreach_due(int);
drop function if exists public.cx_appeal_sweep(), public.cx_message_email_kick(), public.cx_edge_kick(text, jsonb),
  public.cx_message_email_mark(bigint, boolean, text), public.cx_message_email_batch(int),
  public.cx_attachment_orphans(int), public.cx_attachment_folder_ok(text);
drop function if exists public.gc_ban(uuid, uuid, boolean), public.gc_set_paused(uuid, boolean), public.gc_delete_message(uuid),
  public.gc_post(uuid, text, text), public.gc_messages(uuid), public.gc_set_enabled(uuid, boolean), public.gc_status(uuid), public.gc_list(),
  public.cx_gc_purge(), public.cx_gc_summary(uuid, text), public.cx_gc_add(uuid, text, text, text), public.cx_gc_room(uuid),
  public.cx_gc_violation(text, text), public.cx_gc_can_read(uuid), public.cx_gc_role(uuid), public.cx_gc_ttl_hours();
drop function if exists public.appeal_outbox_count(), public.support_open(text, text), public.appeal_resolve(uuid, text),
  public.appeal_post(uuid, text, text), public.appeal_open(uuid, text), public.appeal_thread(uuid), public.appeal_unread(), public.appeal_list();
drop function if exists public.cx_appeal_notify(uuid, text, text), public.cx_appeal_add(uuid, text, text, text), public.cx_appeal_row(uuid, uuid),
  public.cx_appeal_unread(uuid, uuid), public.cx_chat_image_ok(text, text), public.cx_chat_text(text, boolean),
  public.cx_appeal_role(), public.cx_appeal_visible(uuid), public.cx_admin_emails(), public.cx_queue_message_email(text, text, text, text, uuid), public.cx_email_of(uuid),
  public.cx_chat_violation(text, boolean);
drop function if exists public.ugc_campaigns(), public.creator_set_type(text), public.creator_get_type(),
  public.cx_is_ugc_campaign(uuid), public.cx_is_campaign_member(uuid, uuid), public.cx_display_name(uuid);


-- tables added by the new features (policies go with them)
drop table if exists public.cx_lead_outreach, public.cx_lead_outreach_config;
drop table if exists public.campaign_chat_messages, public.campaign_chat_reads, public.campaign_chat_bans, public.campaign_chats;
drop table if exists public.appeal_reads, public.appeal_messages, public.appeals, public.cx_message_outbox;
drop table if exists public.creator_types;


commit;
