-- =============================================================
-- CLIPATHON · 010 · seed Season 1 and Cycle 01
-- =============================================================
-- Configuration, not test data. No fake creators, no fake submissions:
-- everything here is a real row the event actually needs, so this file
-- is safe to run against production.
--
-- The five brands are placeholders matching the dashboard build. Rename
-- them in the admin console when the deals close; nothing else changes.
-- =============================================================

-- -------------------------------------------------------------
-- Season 1
-- -------------------------------------------------------------
insert into clipathon.seasons (code, name, starts_at, ends_at, is_current)
values (
  'season-1', 'Season 1',
  timestamptz '2026-09-01 00:00:00+05:30',
  timestamptz '2026-11-30 23:59:59+05:30',
  true
)
on conflict (code) do nothing;

-- -------------------------------------------------------------
-- Cycle 01
-- -------------------------------------------------------------
-- registration_closes is the only date entered. The rest of the clock
-- is generated, and matches the countdown on clipathon.html exactly.
insert into clipathon.cycles (
  code, name, city, status, registration_closes,
  brand_count, slots_per_brand, prize_pool_minor, currency, season_id, venue
)
select
  'cycle-01', 'Cycle 01', 'Bangalore', 'draft',
  timestamptz '2026-09-07 23:59:00+05:30',
  5, 100, 15000000, 'INR',
  s.id,
  'Bangalore, venue announced at T-72h'
from clipathon.seasons s
where s.code = 'season-1'
on conflict (code) do nothing;

-- The final snapshot time, published to creators in advance and
-- identical for everyone. Nine hours before the ceremony.
update clipathon.cycles
   set final_snapshot_at = finale_at - interval '9 hours'
 where code = 'cycle-01' and final_snapshot_at is null;

-- -------------------------------------------------------------
-- Brands
-- -------------------------------------------------------------
insert into clipathon.brands (
  cycle_id, slug, name, category, summary, brief,
  must_include, never_say, hashtags, mentions,
  content_style, duration_min_sec, duration_max_sec, reward_note,
  slots_total, display_order
)
select c.id, v.slug, v.name, v.category, v.summary, v.brief,
       v.must_include, v.never_say, v.hashtags, v.mentions,
       v.style, v.dmin, v.dmax, v.reward,
       c.slots_per_brand, v.ord
from clipathon.cycles c
cross join (values
  ('aurea', 'Aurea Skincare', 'Beauty · DTC',
   'A three step routine built for humid Indian summers. Loud results, quiet packaging.',
   'Aurea wants first-person routine content. Show the product inside a real morning, not on a shelf.',
   array['Say the full product name once in the first 5 seconds',
         'Show the texture on skin, not just the bottle',
         'Mention the 14 day trial',
         'Tag @aurea.in and use #AureaRoutine'],
   array['Do not claim it treats acne, eczema or any medical condition',
         'Do not compare against a named competitor',
         'No filters that alter skin texture'],
   array['AureaRoutine'], array['aurea.in'],
   'Get ready with me, routine, honest review.', 20, 45,
   'Product kit worth INR 4,000 plus prize eligibility', 1),

  ('orbit', 'Orbit Audio', 'Consumer tech',
   'Open ear earbuds for people who run, ride and still want to hear the city.',
   'Orbit wants the product used in motion. The hook has to land before the logo does.',
   array['Open on movement, not on the box',
         'Say "open ear" in the first line',
         'Show the 40 hour case claim on screen',
         'Tag @orbitaudio and use #HearEverything'],
   array['Do not stage a fake unboxing',
         'Do not claim noise cancellation, this is the opposite',
         'No indoor-only footage'],
   array['HearEverything'], array['orbitaudio'],
   'Day in the life, product demo, POV.', 15, 40,
   'Earbuds to keep plus prize eligibility', 2),

  ('tiffin', 'Tiffin Club', 'Food · Subscription',
   'Home style meal boxes delivered to hostels and PGs across Bangalore.',
   'Tiffin Club wants student truth. The hostel room, the 11pm hunger, the actual box.',
   array['Show the box being opened on camera',
         'Say the weekly price once',
         'Name your campus or area',
         'Tag @tiffinclub.blr and use #TiffinClubBLR'],
   array['Do not disparage mess food by name',
         'No claims about calories or nutrition',
         'Do not film another brand''s packaging'],
   array['TiffinClubBLR'], array['tiffinclub.blr'],
   'Student vlog, food POV, relatable comedy.', 20, 50,
   'One month free subscription plus prize eligibility', 3),

  ('nimbus', 'Nimbus Learn', 'Edtech · App',
   'Fifteen minute skill lessons built for the gap between two classes.',
   'Nimbus wants the app on screen and a real thing you learned. Teach the viewer something in the clip itself.',
   array['Screen record at least one lesson',
         'Teach one genuine takeaway to camera',
         'Say "free for students" once',
         'Tag @nimbuslearn and use #FifteenMinuteSkill'],
   array['Do not promise exam results or placements',
         'Do not show any paywalled content',
         'No fabricated testimonials'],
   array['FifteenMinuteSkill'], array['nimbuslearn'],
   'Talking head, screen record, tutorial.', 25, 60,
   'One year Nimbus Pro plus prize eligibility', 4),

  ('kavi', 'Kavi Threads', 'Fashion · DTC',
   'Handloom shirts cut for city wear. One weaver, one label, printed inside the collar.',
   'Kavi wants craft made visible. Show the fabric close, then show it worn.',
   array['One close-up of the weave in the first 8 seconds',
         'Read the weaver credit inside the collar on camera',
         'Say the fabric name',
         'Tag @kavithreads and use #WornAndWoven'],
   array['Do not call it fast fashion or budget',
         'Do not iron out the slubs in edit, texture is the point',
         'No haul format with other brands'],
   array['WornAndWoven'], array['kavithreads'],
   'Fit check, styling, craft close-up.', 15, 40,
   'Two shirts of your choice plus prize eligibility', 5)
) as v(slug, name, category, summary, brief, must_include, never_say,
       hashtags, mentions, style, dmin, dmax, reward, ord)
where c.code = 'cycle-01'
on conflict (cycle_id, slug) do nothing;

-- -------------------------------------------------------------
-- Bonus task catalogue
-- -------------------------------------------------------------
-- Points are per cycle so they can be tuned after Cycle 01 without
-- rewriting history. `is_auto` marks the ones the platform observes.
insert into clipathon.tasks (
  cycle_id, code, category, title, blurb, why, how_steps, points,
  is_auto, unlock_status, target_route, sort_order
)
select c.id, v.code, v.cat::clipathon.task_category, v.title, v.blurb, v.why, v.steps, v.pts,
       v.auto, v.unlock::clipathon.cycle_status, v.route, v.ord
from clipathon.cycles c
cross join (values
  ('verify-handle','setup','Verify a social handle',
   'Confirm one of your accounts with a code in your bio.',
   'Slot selection stays locked until one handle is verified. It is the only thing standing between you and a brand.',
   array['Open the Profile tab','Press + Add next to Instagram, YouTube or TikTok',
         'Enter your username and copy the code we generate',
         'Paste the code anywhere in your bio and save',
         'Come back and press I have added it'],
   150, true, null, 'profile', 1),

  ('profile-complete','setup','Complete your profile',
   'Display name, city and campus, one content category.',
   'Brands get the roster with your name, city and categories on it. A blank profile is the one that gets skipped.',
   array['Open the Profile tab','Set a display name','Add your city and campus',
         'Pick at least one content category'],
   100, true, null, 'profile', 2),

  ('second-platform','setup','Connect a second platform',
   'Verify a handle on another platform.',
   'If you post the same clip in two places we measure the better performing one, so a second handle can only help.',
   array['Open the Profile tab','Add a handle on a second platform',
         'Verify it with the bio code the same way'],
   120, true, null, 'profile', 3),

  ('rules-brief','learn','Attend the rules briefing',
   'One hour on scoring, format and deadlines.',
   'Most disqualifications come from something covered in this hour.',
   array['Find the session in your announcements feed','Join live, or open the recording afterwards',
         'Come back here and mark it complete'],
   200, false, 'reveal', 'tasks', 4),

  ('brand-deepdive','learn','Watch a brand deep dive',
   'Any one of the five.',
   'The brand tells you in its own words what it wants. That lands in your compliance score, 15 percent of the total.',
   array['Pick any one of the five deep dives','Join live or watch the recording',
         'Mark it complete here'],
   180, false, 'reveal', 'tasks', 5),

  ('craft-workshop','learn','Attend the craft workshop',
   'Hooks, retention, pacing and CTA placement.',
   'This is the session that moves your content quality score, 20 percent of the total.',
   array['Find the craft workshop in your announcements feed','Join live or watch the recording',
         'Mark it complete here'],
   180, false, 'reveal', 'tasks', 6),

  ('pick-slot','create','Lock in your brand slot',
   'Choose your brand inside the window.',
   'Choosing beats being assigned. Auto assignment puts you on whichever brand has room.',
   array['Open Slot Selection when the window opens','Read the briefs first, the window is short',
         'Select a brand and confirm'],
   250, true, 'slot_selection', 'slots', 7),

  ('submit-link','create','Submit your post link',
   'The public URL of your published clip.',
   'This link is what the tracking system polls. No link means no views, no score and no prize.',
   array['Publish your clip publicly on your own channel','Copy the post URL',
         'Paste it into the campaign card on Overview'],
   300, true, 'creation', 'overview', 8),

  ('upload-raw','create','Upload your raw file',
   'The exported MP4 or MOV.',
   'The raw file is what the brand licenses. Missing it makes your entry incomplete.',
   array['Export your clip as MP4 or MOV','Open the campaign card on Overview',
         'Upload it under Path B'],
   300, true, 'creation', 'overview', 9),

  ('early-post','create','Publish in the first 48 hours',
   'The highest value task on the board.',
   'Views are counted at a fixed snapshot on finale day. Post on day one and your clip has three days to accumulate.',
   array['Publish inside the first 48 hours of the window','Submit the link straight away',
         'The bonus applies itself'],
   400, true, 'creation', 'overview', 10),

  ('join-wa','community','Join your brand group',
   'Every brand has its own creator group.',
   'Brand clarifications get answered once, publicly, in the group.',
   array['Check your approval email for your brand group link','Join it','Mark this complete'],
   100, false, 'slot_selection', 'tasks', 11),

  ('share-announce','community','Share the Clipathon',
   'One story, tagged, up for 24 hours.',
   'It costs you one story and it is the cheapest 120 points on the board.',
   array['Post the Clipathon card to your story','Tag @clipency.in','Keep it up for 24 hours'],
   120, false, null, 'tasks', 12),

  ('testimonial','community','Record a finale testimonial',
   'Thirty seconds to camera at the venue.',
   'The recap reel is what recruits the next cycle, and creators in it get featured on our channels.',
   array['Find our team at the venue on finale night','Give us 30 seconds to camera','That is it'],
   200, false, 'finale', 'tasks', 13)
) as v(code, cat, title, blurb, why, steps, pts, auto, unlock, route, ord)
where c.code = 'cycle-01'
on conflict (cycle_id, code) do nothing;

-- Referrals are not a task. They are their own earning line, paid at
-- 250 per approved referral by the trigger in 009, which is why there
-- is no 'refer' row above: two sources paying for the same first
-- referral would double-credit it.

-- -------------------------------------------------------------
-- Prize pool
-- -------------------------------------------------------------
-- Cash split left at zero deliberately. The pool total is public
-- (INR 1,50,000) but the per-position amounts are set per cycle, and
-- publishing a number here that finance has not cleared would be worse
-- than leaving it blank. Fill these in, then set published_at, after
-- which 009 freezes them.
insert into clipathon.prizes (cycle_id, kind, label, rank_from, rank_to, non_cash, seats, sort_order)
select c.id, v.kind::clipathon.prize_kind, v.label, v.rf, v.rt, v.non_cash, v.seats, v.ord
from clipathon.cycles c
cross join (values
  ('overall','Champion',            1,  1,  'Overall winner',            1,  1),
  ('overall','Runner-up',           2,  2,  'Second overall',            1,  2),
  ('overall','Third place',         3,  3,  'Third overall',             1,  3),
  ('overall','4th to 10th',         4,  10, 'Cash and gift hamper',      7,  4),
  ('overall','11th to 50th',        11, 50, 'Gift hamper and vouchers',  40, 5),
  ('special','Best hook',           null, null, 'Special recognition',   1,  6),
  ('special','Best editing',        null, null, 'Special recognition',   1,  7),
  ('season', 'Season 1 top 3',      1,  3,  'Prize money or vouchers',   3,  8)
) as v(kind, label, rf, rt, non_cash, seats, ord)
where c.code = 'cycle-01'
on conflict do nothing;

-- Per-brand winner tiers, one row per brand.
insert into clipathon.prizes (cycle_id, kind, brand_id, label, rank_from, rank_to, non_cash, seats, sort_order)
select b.cycle_id, 'brand', b.id, b.name || ' cohort winner', 1, 1, 'Top performer in this brand cohort', 1, 20 + b.display_order
from clipathon.brands b
join clipathon.cycles c on c.id = b.cycle_id
where c.code = 'cycle-01'
on conflict do nothing;

-- -------------------------------------------------------------
-- Sessions
-- -------------------------------------------------------------
-- Times are derived from the cycle clock, so re-dating the cycle
-- re-dates the schedule with it.
insert into clipathon.sessions (cycle_id, kind, title, agenda, host, starts_at, duration_min)
select c.id, v.kind::clipathon.session_kind, v.title, v.agenda, v.host,
       c.registration_closes + v.offset_h * interval '1 hour', v.mins
from clipathon.cycles c
cross join (values
  ('rules','Clipathon rules briefing',
   'Format walkthrough, the full timeline, submission requirements, the scoring model, disqualification grounds and the prize structure.',
   'Clipency Ops', 3, 60),
  ('workshop','Content craft workshop',
   'Hooks, retention, pacing, on screen text, CTA placement and platform formatting for Reels and Shorts.',
   'Clipency Content', 16, 75),
  ('walkthrough','Slot selection walkthrough',
   'Exactly how the slot mechanic works, how to choose, and what happens when a brand fills up.',
   'Clipency Ops', 20, 30)
) as v(kind, title, agenda, host, offset_h, mins)
where c.code = 'cycle-01'
on conflict do nothing;

-- One deep dive per brand, spaced across the two education days.
insert into clipathon.sessions (cycle_id, brand_id, kind, title, agenda, host, starts_at, duration_min)
select b.cycle_id, b.id, 'brand_deep_dive',
       'Brand deep dive · ' || b.name,
       'Product, audience, message and content expectations, followed by live Q and A.',
       b.name || ' + Partnerships',
       c.registration_closes + ((5 + b.display_order * 2) * interval '1 hour'),
       45
from clipathon.brands b
join clipathon.cycles c on c.id = b.cycle_id
where c.code = 'cycle-01'
on conflict do nothing;

-- -------------------------------------------------------------
-- Milestone announcements
-- -------------------------------------------------------------
-- publish_at is set 25 hours ahead so the 24 hour rule constraint in
-- 002 is satisfied with an hour to spare.
insert into clipathon.announcements (cycle_id, kind, title, body, event_at, publish_at, is_pinned)
select c.id, 'deadline', v.title, v.body, v.at, v.at - interval '25 hours', v.pin
from clipathon.cycles c
cross join lateral (values
  ('Registration closes',
   'The roster locks at this moment. Anyone still unverified after the cutoff rolls into the next cycle.',
   c.registration_closes, true),
  ('All five brands revealed',
   'Every brief goes live on the Slot Selection tab at the same second. Read all five before you decide.',
   c.brands_reveal_at, true),
  ('Slot selection window opens',
   '100 slots per brand, first come first served. Your account has to be verified before you can select.',
   c.slots_open_at, true),
  ('Slot selection closes and the 72 hour clock starts',
   'Anyone who has not selected is auto assigned to the brand with the most slots left and notified immediately.',
   c.slots_close_at, false),
  ('Submission cutoff',
   'Both the live post link and the raw file must be in by this moment. There is no grace period.',
   c.submission_cutoff_at, true),
  ('Finale night',
   'Results brand by brand, then overall. Prizes on stage, e-certificates to your dashboard, and the season leaderboard revealed live.',
   c.finale_at, true)
) as v(title, body, at, pin)
where c.code = 'cycle-01'
on conflict do nothing;
