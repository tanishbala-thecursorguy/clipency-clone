-- 063: less background disk work (Supabase "running out of Disk IO Budget" warning).
--
-- The database is ~30 MB; the budget goes on background jobs writing all day.
--   1. Newsletter timer every 10 minutes instead of 2. Each kick can send up to 90
--      and the cap is 50 a day, so nothing goes out later in any way that matters.
--   2. pg_cron keeps a row for every run in cron.job_run_details and never clears it
--      (5,500+ runs in 10 days). Keep the last 7 days, cleared nightly at 03:30 IST.
-- (3, in fetch-clip-metrics: unchanged clip numbers no longer rewrite the clip or add
--  a history row.) No app table or data changes.

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'cx_promo_emails'),
                      schedule := '*/10 * * * *');

select cron.schedule('cx_cron_log_cleanup', '0 22 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
