CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- No client access at all
CREATE POLICY "deny client select on app_settings" ON public.app_settings
  FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny client insert on app_settings" ON public.app_settings
  FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "deny client update on app_settings" ON public.app_settings
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on app_settings" ON public.app_settings
  FOR DELETE TO anon, authenticated USING (false);

INSERT INTO public.app_settings (key, value) VALUES
  ('push_webhook_url', 'https://teen-wallet.lovable.app/api/public/push-fanout')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Update trigger function to read from app_settings
CREATE OR REPLACE FUNCTION public.notify_push_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _url text;
  _secret text;
BEGIN
  SELECT value INTO _url FROM public.app_settings WHERE key = 'push_webhook_url';
  SELECT value INTO _secret FROM public.app_settings WHERE key = 'push_webhook_secret';

  IF _url IS NULL OR _url = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', COALESCE(_secret, '')
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id', NEW.user_id,
      'type', NEW.type,
      'title', NEW.title,
      'body', NEW.body
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_push_on_insert() FROM PUBLIC, anon, authenticated;