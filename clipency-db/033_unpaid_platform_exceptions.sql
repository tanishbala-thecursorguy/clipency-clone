-- 033_unpaid_platform_exceptions.sql
-- Creators who still see a campaign's unpaid-platform clips.
--
-- When a campaign pays nothing on one of its platforms (a zero row in
-- campaign_platform_rates, next to a paid one), the creator dashboard leaves
-- that platform's clips out entirely (clipper.html, loadUnpaid). This column
-- names the creators for whom it does not: their dashboard shows those clips
-- as before. Display only; nothing about pay, approval or the client's view
-- changes.
--
-- Vingo (Instagram paid, YouTube at 0): Aniket and Ananya keep seeing their
-- YouTube clips, everyone else does not.

alter table public.campaigns
  add column if not exists unpaid_show_to uuid[] not null default '{}';

comment on column public.campaigns.unpaid_show_to is
  'Creators (profile ids) whose dashboard still shows this campaign''s clips on platforms the campaign pays nothing for. Everyone else has those clips left out of their dashboard. Display only.';

update public.campaigns
   set unpaid_show_to = array['e75ac1b6-d2cb-4498-a72a-49010b4b212d', '4f89883c-f7cb-4dc0-af6a-f4f1b247cca2']::uuid[]
 where id = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
