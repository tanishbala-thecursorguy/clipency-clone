-- 054: promotions send 50 emails a day in total: at most 10 per inbox x 5 inboxes
-- (owner's request 2026-11-02, replacing 053's 50 per inbox). The weekly article to
-- ~900 people therefore goes out over ~18 days; the weekly draft task skips while a
-- promo still has queued recipients, so the next newsletter starts after it finishes.
-- An inbox paused for spam complaints/bounces (053) sends nothing for 3 days, so the
-- day's total is 40 while it rests.
create or replace function public.promo_inbox_cap()
returns int language sql immutable as $$ select 10 $$;
