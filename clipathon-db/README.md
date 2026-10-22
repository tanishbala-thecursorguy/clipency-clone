# Clipathon database

A complete Postgres schema for the Clipathon event platform, built to be
managed from its own admin console rather than the clipping console.

Nothing here touches the existing product. There is not a single
reference to `public.profiles`, `public.campaigns`, `public.clip_submissions`
or any other clipping table in these files.

---

## Why a separate schema, not separate tables in `public`

Everything lives in a `clipathon` schema.

**PostgREST exposure is per schema.** The clipping console exposes
`public`. The Clipathon console exposes `clipathon`. An anon or
authenticated key scoped to one cannot see the other, so the separation
is enforced by Postgres rather than by remembering to filter.

**The names are already taken, and they mean something else.**
`campaigns`, `submissions` and `admin_users` all exist in `public` with
different shapes. A Clipathon `submission` is one entry per creator per
cycle with two mandatory paths; a clipping `clip_submission` is one row
per clip with an RPM payout attached. Reusing the name would guarantee
somebody eventually joins the wrong one.

**A cycle can be rebuilt without fear.** `drop schema clipathon cascade`
takes the whole event platform and leaves 572 profiles, 162 clip
submissions and every payout record untouched.

**Roles differ.** `public.admin_users` is a flat list. Running a
Clipathon needs a reviewer who can clear the verification queue without
being able to edit the prize pool, so `clipathon.admin_users` has seven
roles and the RLS policies read them.

### The one thing that is shared

`auth.users`, which is Supabase's own login table and not a clipping
one. A clipper entering a Clipathon signs in with the account they
already have. Even that link is nullable: registration happens through a
form before any account exists, and `creators.auth_user_id` is filled in
at first sign in.

What is **not** shared: profiles, social account verification, roles,
money, and the audit trail.

---

## Files, in order

| File | Contents |
|---|---|
| `001_schema_and_types.sql` | Schema, 18 enums, console roles, RLS helper functions, grants |
| `002_cycles_brands.sql` | `cycles`, `brands`, `brand_assets`, `sessions`, `announcements` |
| `003_creators.sql` | `creators`, `registrations`, `creator_accounts`, `ambassadors`, `referrals` |
| `004_slots_submissions.sql` | `slots`, `submissions`, `metric_snapshots` |
| `005_scoring_points.sql` | `scores`, `tasks`, `task_completions`, `seasons`, `points_ledger`, `season_standings` |
| `006_prizes_support.sql` | `prizes`, `prize_awards`, `certificates`, `payouts`, support tickets, audit log |
| `007_views.sql` | Leaderboards, referral funnel, slot fill, verification queue, QC queue, cycle health |
| `008_rls.sql` | Row level security on all 27 tables |
| `009_triggers.sql` | The business rules that must not depend on the app |
| `010_seed_cycle_01.sql` | Season 1, Cycle 01, five brands, 13 bonus tasks, prize tiers, sessions, milestones |

Run them in numeric order. `010` is configuration, not test data: no
fake creators, no fake submissions, safe against production.

---

## The four ideas worth knowing

### 1. One anchor drives the whole clock

`cycles.registration_closes` is the only date anyone enters. Day 5.
Everything else is derived by trigger:

```
registration_opens   = anchor - 5 days
brands_reveal_at     = anchor
slots_open_at        = anchor + 1 day
slots_close_at       = anchor + 1 day 6 hours
submission_cutoff_at = slots_close + 72 hours   <- the clock starts when the window shuts
finale_at            = anchor + 5 days
```

Move the anchor and the sessions and announcements shift with it, so
re-dating a cycle cannot leave the schedule pointing at the old times.

These are real columns maintained by a trigger rather than `GENERATED`
columns, because `timestamptz + interval` is STABLE, not IMMUTABLE:
day arithmetic depends on the session TimeZone and Postgres rejects it
in a generated column.

### 2. The points ledger is the only source of truth

There is no `points` integer on any table. `points_ledger` is append
only with signed amounts, and every row names its source
(`task`, `referral`, `result`, `streak`, `adjustment`) plus the thing
that caused it. Standings are `sum(amount)`.

A revoked task writes the matching negative rather than deleting the
original, so the history of a standing is always reconstructable and
every manual adjustment has an author and a reason attached. Unique
partial indexes make a retry unable to pay twice for the same task or
referral.

### 3. A referral pays only on an approved clip

This is enforced in three places, not one:

- a **check constraint** on `referrals` that makes `points_awarded > 0`
  impossible unless `stage = 'approved'` and the qualifying submission
  is recorded
- a **trigger** that moves the referral through
  invited → verified → submitted → approved and writes the ledger row on
  exactly one transition
- a **unique index** so the credit cannot be applied twice

Signups pay nothing. Verified accounts pay nothing. A disqualified clip
moves the referral to `rejected`, which is terminal.

### 4. Slot capacity survives the stampede

Slot selection is 500 creators hitting five counters in the same few
minutes. `claim_slot()` takes `SELECT ... FOR UPDATE` on the brand row
before incrementing, so two simultaneous selections serialise instead of
both reading 99 and both writing 100.

Verified by test: 40 concurrent inserts against a 20 seat brand produced
exactly 20 slots and a counter of exactly 20.

---

## What the database refuses to do

These are enforced by constraint or trigger, so no code path and no
console bug can get around them.

| Rule | Enforcement |
|---|---|
| Selection is final once confirmed | No UPDATE or DELETE policy on `slots` for creators |
| A brand cannot be oversold | Row lock in `claim_slot()` |
| One brand per creator per cycle | `slots_one_per_registration` unique |
| Both submission paths are mandatory | `is_complete` generated; `verified` blocked without it |
| Nothing after the cutoff | `enforce_cutoff()`, admin QC exempted |
| Snapshots are evidence | UPDATE and DELETE raise |
| Scoring weights frozen once published | `freeze_scoring()` |
| Weights must total 100 | `cycles_weights_sum` |
| Prize tiers frozen once published | `freeze_prizes()` |
| Two distinct people sign off results | `scores_two_person_signoff`, `scores_lock_needs_signoff` |
| Every deadline announced 24h ahead | `announcements_24h_rule` |
| Briefs invisible before the reveal | RLS on `brands` reads `cycles.status` |
| Unlocked scores invisible to creators | RLS on `scores` requires `locked_at` |
| No self referral | `registrations_no_self_referral` |
| One handle claimed once, ever | `creator_accounts_handle_unique` |

---

## Security model

Three audiences:

- **creator** — reads their own rows, writes a narrow set (their slot
  once, their submission before the cutoff, their manual task claims,
  their tickets)
- **console operator** — scoped by role through `clipathon.has_role()`
- **service_role** — cron jobs and edge functions, bypasses RLS, never
  reaches a browser

`anon` has no grants at all. The public leaderboard should be served by
a service-role edge function that selects only display name and points,
so a published key cannot enumerate creator emails and phone numbers.

RLS is enabled on all 27 tables. With RLS on and no matching policy the
default is DENY, so a table added later and forgotten in `008` is
unreachable rather than public.

Both RLS helper functions are `SECURITY DEFINER` with
`set search_path = clipathon, pg_temp`. Without the pinned path, a
caller who can create objects in their own schema could shadow
`admin_users` and grant themselves any role.

Money is stored in minor units (`bigint` paise), never float. Bank
account numbers are stored as last four digits only.

---

## Testing

The migrations were executed end to end against PostgreSQL 16 with a
stubbed `auth` schema, then exercised with 41 assertions covering the
cycle clock, slot capacity, the full referral lifecycle, task points and
revocation, snapshot immutability, both freezes, the 24 hour rule, SLA
derivation and every view.

Two real bugs were found this way and fixed:

1. The derived clock could not be `GENERATED` columns (STABLE, not
   IMMUTABLE) — now a trigger.
2. `AFTER UPDATE OF status` never fired, because `status` is set by the
   BEFORE trigger rather than by the UPDATE statement, and `UPDATE OF`
   matches the statement's column list. A creator uploading their raw
   file therefore never advanced the referral. Now `AFTER UPDATE` with
   internal guards.

To re-run locally:

```bash
createdb cliptest
psql -d cliptest -f 000_supabase_stub.sql   # local only, not part of the set
for f in 0*.sql; do psql -d cliptest -v ON_ERROR_STOP=1 -f "$f"; done
```

---

## The admin console

`clipathon-admin.html` is the operations console. It reads the tables and
views directly under RLS and routes every consequential action through the
`admin_*` functions in `016`, so the role check and the audit trail cannot
be skipped by a bug on the page. Nineteen sections, one per part of a
cycle: overview, verification queue, account checker, slots, QC, scoring
and sign off, brands, tasks and points, sessions and feed, prizes,
creators, points ledger, referrals, ambassadors, payouts, support, cycle
settings, operators, audit log.

Building it surfaced two things, fixed in `017`:

- `tickets_admin` was `ALL / is_admin()`, and `is_admin()` is true for
  every role including `readonly`. The one role whose whole purpose is
  "can look, cannot touch" could resolve tickets and post internal notes.
  Split into read for all operators, write for ops, reviewer and
  marketing. There is deliberately no delete policy.
- `admin_overview.tickets_breach` counted resolved tickets, so a ticket
  answered in one reply without the first-response stamp sat in that
  number permanently. A breach is only a breach while the ticket is open.

The role matrix the console gates on, verified against production:

| | readonly | reviewer | partnerships | marketing | finance | ops | owner |
|---|---|---|---|---|---|---|---|
| open the console | yes | yes | yes | yes | yes | yes | yes |
| review queue, handles | - | yes | - | - | - | yes | yes |
| support tickets | - | yes | - | yes | - | yes | yes |
| brands and briefs | - | - | yes | - | - | yes | yes |
| sessions | - | - | yes | yes | - | yes | yes |
| the feed | - | - | - | yes | - | yes | yes |
| ambassadors | - | - | - | yes | - | yes | yes |
| cycle, slots, scoring, tasks, points | - | - | - | - | - | yes | yes |
| prizes and payouts | - | - | - | - | yes | - | yes |
| grant a role | - | - | - | - | - | - | yes |

Nobody, owner included, can write to `audit_log` or edit a captured
`metric_snapshot`. Those are enforced by the absence of a policy and by a
trigger respectively, not by the console.

## What the admin console needs to build

The views in `007` are shaped to be the console's screens:

| View | Screen |
|---|---|
| `v_verification_queue` | The registration queue, with `age_hours` against the daily clearance target |
| `v_qc_queue` | Submissions awaiting QC, flagged `past_cutoff` |
| `v_brand_fill` | Live slot counters and fill velocity during the window |
| `v_cycle_health` | Acquisition against the 500 target, verified count, DQ count |
| `v_cycle_results` | The ranked table, `is_final` until signed off |
| `v_season_leaderboard` | Standings with the per-source breakdown |
| `v_referral_funnel` / `v_referral_leaderboard` | Referral pipeline and top referrers |
| `v_ambassador_performance` | Attribution, paid on verified registrations only |

Still to build outside the database:

- the metric polling job that writes `metric_snapshots`
- the scoring run that fills `scores` from the final snapshot
- the notification worker that reads `announcements.notify_t24_at` and
  `notify_t1_at`
- the Drive integration that mirrors raw files into
  `/Clipathon-[cycle]/[brand]/[creator]-[id]/`
- auto assignment at the slot window close (insert with
  `auto_assigned = true`, which the trigger permits outside the window)
