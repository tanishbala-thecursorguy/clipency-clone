/* Regression test for private campaigns, the agency margin and per-creator
   settlement. Runs entirely inside a transaction that is rolled back, so it
   is safe against production — it seeds four campaigns, drives real clip
   submissions through the live triggers, then checks what each role can
   actually see.

   Run it after any change to campaign_creator_pool, cs_calc_earning,
   cx_settle_creator_campaign or client_dashboard_data. Expect:
       LAYER4 CLEAN (21 probes)

   The two user ids below are real non-staff accounts used as stand-ins for
   a clipper and a client; swap them if those accounts ever go away.
*/
begin;
create temp table p(n serial, probe text, got text, want text) on commit drop;
grant all on p to authenticated;
grant all on sequence p_n_seq to authenticated;

insert into public.campaigns
  (id,title,brand_name,status,is_private,payout_model,rate_per_video,client_rate_per_video,rpm,client_rpm,
   budget,budget_used,platform_fee_percent,fee_mode,min_videos_per_creator,platform,genre,currency,created_at,client_user_id)
values
 ('00000000-0000-4000-8000-00000000f001','SEC private','P','active',true ,'per_video',2.00,0   ,0,0,1000,0,20,'inclusive',0,'Instagram','UGC','USD',now(),null),
 ('00000000-0000-4000-8000-00000000f002','SEC public','P','active' ,false,'per_view' ,0   ,0   ,1000,0,500,0,20,'inclusive',0,'YouTube','Clipping','USD',now(),null),
 ('00000000-0000-4000-8000-0000000000a1','AGENCY','Ag','active'    ,false,'per_video',2.00,2.50,0,0,1250,0,15,'on_top',3,'Instagram','UGC','USD',now(),'0cf0b9e3-909f-45d4-b128-2d9cbc599abd'),
 ('00000000-0000-4000-8000-0000000000a2','DIRECT','Di','active'    ,false,'per_video',2.00,0   ,0,0,1000,200,15,'inclusive',0,'Instagram','UGC','USD',now(),'0cf0b9e3-909f-45d4-b128-2d9cbc599abd');

/* ---- money maths ---- */
do $$
declare c public.campaigns%rowtype;
        u uuid := 'f305a30b-bf97-46c8-9391-c1f72dccca08';
        u2 uuid := '2e58611f-b06a-4671-ab6e-f84cd22d5614';
        cid text := '00000000-0000-4000-8000-0000000000a1';
        i int; tot numeric; vid uuid;
begin
  select * into c from public.campaigns where id::text=cid;
  insert into p(probe,got,want) values
    ('creator pool',  public.campaign_creator_pool(c)::text,'1000.00'),
    ('agency margin', public.campaign_agency_margin(c)::text,'250.00'),
    ('fee on top',    public.campaign_fee(c)::text,'187.50');

  for i in 1..2 loop
    insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,clip_url,status,views_count,metrics_status,created_at)
    values (u,cid,'AGENCY','instagram','h','https://e.com/'||i,'approved',5000,'ok',now()+(i||' seconds')::interval);
  end loop;
  select coalesce(sum(earning_amount_native),0) into tot from public.clip_submissions where campaign_id=cid and user_id=u and status='approved';
  insert into p(probe,got,want) values ('below min videos held', tot::text,'0');

  insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,clip_url,status,views_count,metrics_status,created_at)
  values (u,cid,'AGENCY','instagram','h','https://e.com/3','approved',5000,'ok',now()+'3 seconds'::interval);
  select coalesce(sum(earning_amount_native),0) into tot from public.clip_submissions where campaign_id=cid and user_id=u and status='approved';
  insert into p(probe,got,want) values ('min reached pays retroactively', tot::text,'6.00');

  update public.campaigns set max_pay_per_creator=5 where id::text=cid;
  perform public.cx_settle_creator_campaign(u,cid);
  select coalesce(sum(earning_amount_native),0) into tot from public.clip_submissions where campaign_id=cid and user_id=u and status='approved';
  insert into p(probe,got,want) values ('max pay per creator', tot::text,'5.00');
  update public.campaigns set max_pay_per_creator=null where id::text=cid;
  perform public.cx_settle_creator_campaign(u,cid);

  perform set_config('clipency.trusted_write','1',true);
  select id into vid from public.clip_submissions where campaign_id=cid and user_id=u and status='approved' order by created_at desc limit 1;
  update public.clip_submissions set status='rejected' where id=vid;
  perform set_config('clipency.trusted_write','0',true);
  select coalesce(sum(earning_amount_native),0) into tot from public.clip_submissions where campaign_id=cid and user_id=u and status='approved';
  insert into p(probe,got,want) values ('drops back below min', tot::text,'0');

  for i in 1..3 loop
    insert into public.clip_submissions(user_id,campaign_id,campaign_title,platform,handle,clip_url,status,views_count,metrics_status,created_at)
    values (u2,cid,'AGENCY','instagram','h2','https://e.com/b'||i,'approved',5000,'ok',now()+(i||' seconds')::interval);
  end loop;
  select coalesce(sum(earning_amount_native),0) into tot from public.clip_submissions where campaign_id=cid and user_id=u2 and status='approved';
  insert into p(probe,got,want) values ('second creator unaffected', tot::text,'6.00');
  select budget_used into tot from public.campaigns where id::text=cid;
  insert into p(probe,got,want) values ('campaign creator spend', tot::text,'6.00');
end $$;

/* ---- what an outsider clipper can see ---- */
set local role authenticated;
set local request.jwt.claims = '{"sub":"f305a30b-bf97-46c8-9391-c1f72dccca08","role":"authenticated"}';
insert into p(probe,got,want)
select 'outsider sees private row',(select count(*) from public.campaigns where id='00000000-0000-4000-8000-00000000f001')::text,'0'
union all select 'outsider sees public row',(select count(*) from public.campaigns where id='00000000-0000-4000-8000-00000000f002')::text,'1'
union all select 'teaser hides rate',(select coalesce(string_agg(k,','),'none') from jsonb_array_elements(public.cx_private_campaign_teasers()) e, jsonb_object_keys(e) k where k in ('rpm','rate_per_video','client_rate_per_video','max_pay_per_clip')),'none'
union all select 'teaser shows model',(select e->>'payout_model' from jsonb_array_elements(public.cx_private_campaign_teasers()) e where e->>'id'='00000000-0000-4000-8000-00000000f001'),'per_video';
reset role;

/* ---- what the brand can see ---- */
set local role authenticated;
set local request.jwt.claims = '{"sub":"0cf0b9e3-909f-45d4-b128-2d9cbc599abd","role":"authenticated"}';
insert into p(probe,got,want)
select 'brand sees own rate',      e->>'rate_per_video','2.50' from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'brand spend at brand rate',e->>'spent','7.50'        from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'brand remaining',          e->>'remaining','1242.50' from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'creator pool withheld',    coalesce(e->>'creator_pool','withheld'),'withheld' from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'platform fee withheld',    coalesce(e->>'platform_fee','withheld'),'withheld' from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'fee inputs stripped',      (e ? 'platform_fee_percent')::text,'false'          from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'creator rate not sent',    (e ? 'client_rate_per_video')::text,'false'         from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a1'
union all
select 'direct campaign unchanged',coalesce(e->>'creator_pool','withheld'),'850.00'    from jsonb_array_elements(public.client_dashboard_data()->'campaigns') e where e->>'id'='00000000-0000-4000-8000-0000000000a2';
reset role;

select case when count(*) filter (where got is distinct from want)=0
  then 'LAYER4 CLEAN ('||count(*)||' probes)'
  else 'LAYER4 FAIL: '||string_agg(probe||' got='||coalesce(got,'null')||' want='||want,' | ')
       filter (where got is distinct from want) end as result
from p;
rollback;
