-- 058: turn on content-calendar emails (057). Every 10 minutes cal_kick() checks
-- whether any intro / 10 AM / 7 PM / pause email is due (India time) and, only then,
-- calls the creator-reminders edge function. Applied after the owner checked the
-- test emails. To stop all reminders: select cron.unschedule('cx_cal_reminders');
select cron.schedule('cx_cal_reminders', '*/10 * * * *', 'select public.cal_kick()');
