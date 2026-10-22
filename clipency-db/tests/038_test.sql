-- Behaviour tests for 038 (group chats). Local only. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;

insert into auth.users values ('00000000-0000-0000-0000-0000000000c1', 'client@x.test'), ('00000000-0000-0000-0000-0000000000c2', 'other@x.test'),
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test'), ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'dan@x.test'), ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.profiles (id, email, role, display_name) values
  ('00000000-0000-0000-0000-0000000000c1', 'client@x.test', 'client', 'Acme person'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@x.test', 'client', 'Other'),
  ('00000000-0000-0000-0000-0000000000a1', 'amy@x.test', 'clipper', 'Amy'),
  ('00000000-0000-0000-0000-0000000000b1', 'ben@x.test', 'clipper', 'Ben'),
  ('00000000-0000-0000-0000-0000000000d1', 'dan@x.test', 'clipper', 'Dan'),
  ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test', 'admin', 'Boss');
insert into public.admin_users (user_id, email) values ('00000000-0000-0000-0000-0000000000ad', 'boss@x.test');
insert into public.campaigns (id, title, brand_name, client_user_id) values
  ('11111111-0000-0000-0000-000000000001', 'Acme launch', 'Acme', '00000000-0000-0000-0000-0000000000c1');
-- Amy posted a clip, Ben was approved, Dan is not in the campaign
insert into public.clip_submissions (user_id, campaign_id, clip_url) values ('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000001', 'https://www.instagram.com/reel/X1/');
insert into public.campaign_applications (campaign_id, user_id, status) values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'approved');

-- while off: creators see nothing, the client sees the room (off), outsiders nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ begin
  if jsonb_array_length(public.gc_list()) <> 0 then raise exception 'FAIL: creator sees an off chat'; end if;
  if (public.gc_status('11111111-0000-0000-0000-000000000001')->>'role') <> 'creator' then raise exception 'FAIL: Amy not a member'; end if;
  begin perform public.gc_set_enabled('11111111-0000-0000-0000-000000000001', true); raise exception 'FAIL: creator turned chat on';
  exception when others then if sqlerrm not like 'Only the client%' then raise; end if; end;
  begin perform public.gc_messages('11111111-0000-0000-0000-000000000001'); raise exception 'FAIL: creator read an off chat';
  exception when others then if sqlerrm not like '%is off' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  if public.gc_status('11111111-0000-0000-0000-000000000001')->>'role' is not null then raise exception 'FAIL: Dan is a member'; end if;
  raise notice 'PASS 038: off by default; only the client can turn it on; outsiders have no role';
end $$;

-- the client turns it on: free, nothing written to the wallet
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
do $$ declare s jsonb; begin
  perform public.gc_set_enabled('11111111-0000-0000-0000-000000000001', true);
  s := public.gc_status('11111111-0000-0000-0000-000000000001');
  if not (s->>'enabled')::boolean or not (s->>'free')::boolean or (s->>'member_count')::int <> 2 then
    raise exception 'FAIL: status after enable %', s; end if;
  perform public.gc_post('11111111-0000-0000-0000-000000000001', 'Brief is here https://docs.google.com/document/d/abc');
  raise notice 'PASS 038: client turns it on (free), can share a Docs link';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.client_wallet_ledger) then raise exception 'FAIL: something was billed'; end if;
end $$;

-- creators: read, post, link + money rules
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
do $$ declare r jsonb; begin
  r := public.gc_list();
  if jsonb_array_length(r) <> 1 or (r->0->>'unread')::int <> 1 or r->0->>'client_name' <> 'Acme' then raise exception 'FAIL: creator list %', r; end if;
  r := public.gc_messages('11111111-0000-0000-0000-000000000001');
  if jsonb_array_length(r->'messages') <> 2 or r->'messages'->1->>'sender_name' <> 'Acme' then raise exception 'FAIL: messages %', r; end if;
  perform public.gc_post('11111111-0000-0000-0000-000000000001', 'Posted mine https://www.instagram.com/reel/abc/');
  begin perform public.gc_post('11111111-0000-0000-0000-000000000001', 'files at https://docs.google.com/x'); raise exception 'FAIL: creator shared a Docs link';
  exception when others then if sqlerrm not like 'Group chats can’t include outside links%' then raise; end if; end;
  begin perform public.gc_post('11111111-0000-0000-0000-000000000001', 'what is the rpm?'); raise exception 'FAIL: money talk';
  exception when others then if sqlerrm not like 'Group chats can’t include payment%' then raise; end if; end;
  begin perform public.gc_post('11111111-0000-0000-0000-000000000001', 'add me on telegram'); raise exception 'FAIL: chat app';
  exception when others then if sqlerrm not like 'Group chats can’t include other chat apps%' then raise; end if; end;
  if (select count(*) from public.campaign_chat_messages) <> 3 then raise exception 'FAIL: creator RLS read'; end if;
  raise notice 'PASS 038: creators read and post; social links only; money/contact blocked; RLS read works';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
do $$ begin
  if jsonb_array_length(public.gc_list()) <> 0 or (select count(*) from public.campaign_chat_messages) <> 0 then raise exception 'FAIL: other client sees the chat'; end if;
  raise notice 'PASS 038: other clients see nothing';
end $$;
reset role;

-- Clipency: pause, ban Ben, delete a message
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
set role authenticated;
do $$ declare r jsonb; begin
  perform public.gc_set_paused('11111111-0000-0000-0000-000000000001', true);
  perform public.gc_post('11111111-0000-0000-0000-000000000001', 'Payouts for this campaign go out Friday.');   -- admins may talk money
  perform public.gc_ban('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', true);
  begin perform public.gc_ban('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', true); raise exception 'FAIL: banned the client';
  exception when others then if sqlerrm not like 'The client can’t%' then raise; end if; end;
  r := public.gc_status('11111111-0000-0000-0000-000000000001');
  if jsonb_array_length(r->'banned') <> 1 or not (r->>'paused')::boolean then raise exception 'FAIL: admin status %', r; end if;
  perform public.gc_delete_message((select id from public.campaign_chat_messages where body like 'Posted mine%'));
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  begin perform public.gc_post('11111111-0000-0000-0000-000000000001', 'hello?'); raise exception 'FAIL: posted while paused';
  exception when others then if sqlerrm not like 'Clipency has paused%' then raise; end if; end;
  begin perform public.gc_delete_message((select id from public.campaign_chat_messages limit 1)); raise exception 'FAIL: creator deleted';
  exception when others then if sqlerrm not like 'Only Clipency%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  if public.gc_status('11111111-0000-0000-0000-000000000001')->>'role' is not null or (select count(*) from public.campaign_chat_messages) <> 0 then
    raise exception 'FAIL: banned creator still in'; end if;
  raise notice 'PASS 038: Clipency pauses, bans (not the client), deletes; banned people lose access';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.campaign_chat_messages where body like 'Posted mine%') then raise exception 'FAIL: delete'; end if;
end $$;

-- 12h purge
update public.campaign_chat_messages set created_at = now() - interval '13 hours' where sender_role <> 'system';
do $$ declare n int; begin
  n := public.cx_gc_purge();
  if n < 2 or exists (select 1 from public.campaign_chat_messages where created_at < now() - interval '12 hours') then raise exception 'FAIL: purge %', n; end if;
  raise notice 'PASS 038: messages deleted after 12h';
end $$;

-- the browser can't run the scheduled jobs
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', false);
set role authenticated;
do $$ begin
  begin perform public.cx_gc_purge(); raise exception 'FAIL: purge callable by a user';
  exception when insufficient_privilege then null; end;
  raise notice 'ALL 038 TESTS PASSED';
end $$;
reset role;
rollback;
