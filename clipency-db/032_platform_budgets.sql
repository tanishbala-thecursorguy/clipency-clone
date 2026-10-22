-- 032_platform_budgets.sql
-- A budget per platform on a split campaign, and the brand's price per platform
-- on its client dashboard.
--
-- campaigns.platform_budgets  {"instagram": 136500, "youtube": 20000}, in the
--   campaign's own currency. Read only by the client portal, and only on a
--   campaign with platform_split set: each platform listed gets a budget card
--   of its own, read against that platform's spend; the platform_split
--   platform keeps whatever is not given away. Presentation, like
--   platform_split itself: the payout engine still caps the campaign as a
--   whole (campaigns.budget), not each platform. Null = one shared budget.
--
-- client_dashboard_data()  each campaign now also carries client_platform_rates,
--   {"youtube": {"rate_per_video": 50, "rpm": 0}, ...}: what the BRAND is billed
--   per platform (cx_platform_rate's client side, the same figure
--   cx_clip_client_cost bills each clip at). Creator rates are not included.
--   Before this the YouTube half of a split campaign showed the campaign's
--   headline (Instagram) price.
--
-- Re-runnable. The function is patched in place from its live definition so
-- nothing else in it can drift.

alter table public.campaigns add column if not exists platform_budgets jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'campaigns_platform_budgets_object'
                    and conrelid = 'public.campaigns'::regclass) then
    alter table public.campaigns add constraint campaigns_platform_budgets_object
      check (platform_budgets is null or jsonb_typeof(platform_budgets) = 'object');
  end if;
end $$;

comment on column public.campaigns.platform_budgets is
  'Split campaigns only: budget per platform in campaign currency, e.g. {"youtube": 20000}. Client-portal presentation; payouts are capped by campaigns.budget.';

do $$
declare
  d      text := pg_get_functiondef('public.client_dashboard_data()'::regprocedure);
  anchor text := $a$'rate_per_video_native', unit,$a$;
  addon  text := $b$
             'client_platform_rates', (select jsonb_object_agg(pr.platform,
                                          jsonb_build_object('rate_per_video', x.client_rate_per_video,
                                                             'rpm',            x.client_rpm))
                                         from public.campaign_platform_rates pr
                                         cross join lateral public.cx_platform_rate(c.id, pr.platform) x
                                        where pr.campaign_id = c.id),$b$;
begin
  if position('client_platform_rates' in d) > 0 then return; end if;
  if position(anchor in d) = 0 then
    raise exception 'client_dashboard_data(): anchor % not found, patch by hand', anchor;
  end if;
  execute replace(d, anchor, anchor || addon);
end $$;
