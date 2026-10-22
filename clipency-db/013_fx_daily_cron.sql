-- 013 · Refresh the rates once a day.
--
-- 05:10 UTC is after the ECB publishes its daily reference set. The absorb runs
-- two minutes behind the fetch because pg_net answers asynchronously.
select cron.unschedule(jobname) from cron.job
 where jobname in ('cx_fx_fetch','cx_fx_absorb');

select cron.schedule('cx_fx_fetch',  '10 5 * * *', $$select public.cx_fx_fetch();$$);
select cron.schedule('cx_fx_absorb', '12 5 * * *', $$select public.cx_fx_absorb();$$);
