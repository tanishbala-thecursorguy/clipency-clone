-- Behaviour tests for 039 (storage rules, email queue, job kicks). Local only. Rolled back.
\set ON_ERROR_STOP 1
begin;
insert into vault.decrypted_secrets values ('service_role_key', 'test-key');
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'client@x.test'), ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test');
insert into public.profiles (id, email, role, display_name) values ('00000000-0000-0000-0000-0000000000c1', 'client@x.test', 'client', 'Acme'),
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test', 'clipper', 'Amy'), ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test', 'clipper', 'Ben');
insert into public.campaigns (id, title, brand_name, client_user_id) values ('11111111-0000-0000-0000-000000000001', 'Acme launch', 'Acme', '00000000-0000-0000-0000-0000000000c1');
insert into public.clip_submissions (id, user_id, campaign_id, clip_url, status) values
  ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'https://www.instagram.com/reel/Z1/', 'rejected');
grant insert, select on storage.objects to authenticated;   -- Supabase grants these; the policy is what limits them

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select set_config('t.appeal', (public.appeal_open('22222222-0000-0000-0000-000000000001', 'please look again')->>'id'), false);
do $$ begin
  insert into storage.objects (bucket_id, name) values ('appeal-attachments', current_setting('t.appeal') || '/1.jpg');
  begin insert into storage.objects (bucket_id, name) values ('appeal-attachments', gen_random_uuid() || '/1.jpg'); raise exception 'FAIL: uploaded into a stranger''s appeal';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('appeal-attachments', 'gc-11111111-0000-0000-0000-000000000001/1.jpg'); raise exception 'FAIL: uploaded to an off chat';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 039: uploads only into your own threads';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('appeal-attachments', current_setting('t.appeal') || '/2.jpg'); raise exception 'FAIL: Ben uploaded into Amy''s appeal';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- email queue: merges, waits 2 minutes, then hands out once, marks sent / retries
do $$ declare b jsonb; begin
  if jsonb_array_length(public.cx_message_email_batch()) <> 0 then raise exception 'FAIL: sent before the 2-minute merge window'; end if;
  update public.cx_message_outbox set updated_at = now() - interval '3 minutes';
  b := public.cx_message_email_batch();
  if jsonb_array_length(b) <> 1 or b->0->>'to' <> 'client@x.test' then raise exception 'FAIL: batch %', b; end if;
  if jsonb_array_length(public.cx_message_email_batch()) <> 0 then raise exception 'FAIL: handed out twice'; end if;
  perform public.cx_message_email_mark((b->0->>'id')::bigint, false, 'resend 500');
  if (select status from public.cx_message_outbox where id = (b->0->>'id')::bigint) <> 'queued' then raise exception 'FAIL: no retry'; end if;
  perform public.cx_message_email_mark((b->0->>'id')::bigint, true);
  if (select status from public.cx_message_outbox where id = (b->0->>'id')::bigint) <> 'sent' then raise exception 'FAIL: not marked sent'; end if;
  raise notice 'PASS 039: email queue merges, hands out once, retries, marks sent';
end $$;

-- settled appeal -> its image becomes an orphan to delete; kicks only call out when there's work
update storage.objects set created_at = now() - interval '1 hour';
do $$ declare n0 int; begin
  if public.cx_attachment_orphans() <> '[]'::jsonb then raise exception 'FAIL: live appeal image listed'; end if;
  update public.clip_submissions set status = 'approved'; perform public.cx_appeal_sweep();
  if jsonb_array_length(public.cx_attachment_orphans()) <> 1 then raise exception 'FAIL: settled appeal image not listed'; end if;
  select count(*) into n0 from net.calls;
  perform public.cx_message_email_kick();
  if (select count(*) from net.calls) <> n0 + 1 or (select url from net.calls order by id desc limit 1) not like '%/functions/v1/message-emails' then
    raise exception 'FAIL: email kick did not call the function'; end if;
  delete from public.cx_message_outbox; delete from storage.objects;
  perform public.cx_message_email_kick();   -- nothing to do: no call
  if (select count(*) from net.calls) <> n0 + 1 then raise exception 'FAIL: email kick woke the function with nothing to do'; end if;
  raise notice 'PASS 039: settled-chat images queued for deletion; jobs only wake functions when needed';
  raise notice 'ALL 039 TESTS PASSED';
end $$;
rollback;
