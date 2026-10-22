-- 032_platform_split.sql
-- One dashboard per platform for a campaign that runs on several.
--
-- campaigns.platform_split names a platform key ('instagram', 'youtube',
-- 'tiktok'). When set, the client portal shows the campaign as one card and
-- one full dashboard per platform it runs on (overview, review, clips feed,
-- analytics, billing, creators), each holding only that platform's clips,
-- reviews and creators. The admin console lists it the same way and lets the
-- review queue be narrowed to one half. The named platform keeps the budget;
-- the other platforms show no budget of their own.
--
-- Presentation only. Nothing moves in the database: every clip still belongs
-- to the one campaign, bills against its one budget and pays its creators as
-- before, and clippers still see one campaign. client_dashboard_data() sends
-- the whole campaign row (to_jsonb), so the portal picks the column up with
-- no change to the function.

alter table public.campaigns
  add column if not exists platform_split text
  check (platform_split is null or platform_split in ('instagram', 'youtube', 'tiktok'));

comment on column public.campaigns.platform_split is
  'Platform key or null. Set: the client portal and admin console present the campaign as one dashboard per platform; this platform keeps the budget. Presentation only, money is not split.';

-- Vingo {UGC Campaign}: an Instagram dashboard with the budget, a YouTube one without.
update public.campaigns
   set platform_split = 'instagram'
 where id = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61'
   and platform_split is distinct from 'instagram';
