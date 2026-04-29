-- Ensure cron extension is available
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ──────────────────────────────────────────────────────────────────────
-- Daily morning greeting with rotating slogans
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_daily_morning_greetings()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _slogans text[] := ARRAY[
    'Save a little today, smile a lot tomorrow 💰',
    'Every rupee saved is a rupee earned ✨',
    'Small steps lead to big dreams 🚀',
    'Spend smart, live smart 🧠',
    'Your future self will thank you 🙌',
    'Track it. Save it. Grow it. 🌱',
    'Discipline today, freedom tomorrow 🕊️',
    'Be the boss of your money 👑'
  ];
  _slogan text;
BEGIN
  -- Pick a slogan based on day-of-year so it rotates daily
  _slogan := _slogans[1 + (extract(doy FROM now())::int % array_length(_slogans, 1))];

  INSERT INTO public.notifications (user_id, type, title, body)
  SELECT
    p.id,
    'greeting',
    'Good morning, ' || COALESCE(NULLIF(split_part(p.full_name, ' ', 1), ''), 'there') || '! ☀️',
    _slogan
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = p.id
      AND n.type = 'greeting'
      AND n.created_at::date = current_date
  );
END;
$$;

-- ──────────────────────────────────────────────────────────────────────
-- Birthday-saving reminder, sent ~1 month before DOB anniversary
-- ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_birthday_saving_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_date date := (current_date + interval '1 month')::date;
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body)
  SELECT
    p.id,
    'offer',
    '🎂 Start saving for your birthday, ' || COALESCE(NULLIF(split_part(p.full_name, ' ', 1), ''), 'friend') || '!',
    'Your birthday is just a month away. Tips: set aside ₹50/day, skip one impulse buy a week, and round up payments to save the change. You''ll have a treat fund ready! 🎁'
  FROM public.profiles p
  WHERE p.dob IS NOT NULL
    AND extract(month FROM p.dob) = extract(month FROM _target_date)
    AND extract(day FROM p.dob)   = extract(day FROM _target_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = p.id
        AND n.type = 'offer'
        AND n.title LIKE '🎂 Start saving for your birthday%'
        AND n.created_at > now() - interval '60 days'
    );
END;
$$;

-- Schedule daily morning greeting (08:00 UTC ≈ 13:30 IST)
SELECT cron.unschedule('daily-morning-greetings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daily-morning-greetings'
);
SELECT cron.schedule(
  'daily-morning-greetings',
  '30 2 * * *', -- 02:30 UTC = 08:00 IST
  $$ SELECT public.send_daily_morning_greetings(); $$
);

-- Schedule birthday reminder check daily at 03:00 UTC (08:30 IST)
SELECT cron.unschedule('birthday-saving-reminders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'birthday-saving-reminders'
);
SELECT cron.schedule(
  'birthday-saving-reminders',
  '0 3 * * *',
  $$ SELECT public.send_birthday_saving_reminders(); $$
);