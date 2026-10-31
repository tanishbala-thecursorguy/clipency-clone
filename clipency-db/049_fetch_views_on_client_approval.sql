-- 049: fetch a clip's views the moment a client (or the auto-approver) approves it.
-- APPLIED to live (spwtkdgpgeutrhwcjrpy) on 2026-10-31 with the owner's approval.
--
-- Console approvals already pull metrics straight away (Reviews > Approve calls
-- fetch-clip-metrics). Client approvals in the client dashboard and auto-approvals
-- did not, so the clip showed 0 views until the next hourly refresh.
--
-- New function + trigger only. The trigger only fires the request (pg_net, async);
-- it can never block or undo an approval. One ScrapeCreators credit per approval.

create or replace function public.cx_fetch_metrics_on_approve()
returns trigger language plpgsql security definer set search_path = public, extensions, vault as $$
declare key text;
begin
  begin
    select decrypted_secret into key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if key is not null then
      perform net.http_post(
        url     := 'https://spwtkdgpgeutrhwcjrpy.supabase.co/functions/v1/fetch-clip-metrics',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
        body    := jsonb_build_object('submission_id', new.id, 'force', true),
        timeout_milliseconds := 60000);
    end if;
  exception when others then
    raise warning 'cx_fetch_metrics_on_approve: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.cx_fetch_metrics_on_approve() from public, anon, authenticated;

create trigger trg_cx_fetch_metrics_on_approve
  after update of status on public.clip_submissions
  for each row
  when (new.status = 'approved' and old.status is distinct from 'approved'
        and new.review_source in ('client', 'auto'))
  execute function public.cx_fetch_metrics_on_approve();
