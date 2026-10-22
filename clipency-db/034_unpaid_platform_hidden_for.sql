-- 034_unpaid_platform_hidden_for.sql
-- Who does not see a campaign's unpaid-platform clips: the creators named.
--
-- 033 named the creators who DID still see them, with everyone else hidden.
-- That was the wrong way round for Vingo: only Aniket and Ananya should have
-- YouTube left off their dashboard; every other creator keeps seeing theirs.
--
-- unpaid_hidden_for: the creators (profile ids) this applies to.
-- unpaid_hidden_mode: 'listed' (default) hides unpaid-platform clips only for
--   the creators named; 'all_but_listed' hides them for everyone except the
--   creators named. Display only; nothing about pay, approval or the
--   client's view changes. The column rename keeps Vingo's two ids, which
--   under 'listed' now mean exactly what was asked.

alter table public.campaigns rename column unpaid_show_to to unpaid_hidden_for;

alter table public.campaigns
  add column if not exists unpaid_hidden_mode text not null default 'listed'
  check (unpaid_hidden_mode in ('listed', 'all_but_listed'));

comment on column public.campaigns.unpaid_hidden_for is
  'Creators (profile ids) the unpaid-platform rule applies to on this campaign: with unpaid_hidden_mode = listed their dashboard leaves out clips on platforms the campaign pays nothing for; with all_but_listed everyone''s does except theirs. Display only.';
comment on column public.campaigns.unpaid_hidden_mode is
  'listed (default): unpaid-platform clips are hidden only from the creators in unpaid_hidden_for. all_but_listed: hidden from everyone except them.';

update public.campaigns
   set unpaid_hidden_mode = 'listed'
 where id = 'e18bb5d9-5ec8-416b-97a3-558275e3fd61';
