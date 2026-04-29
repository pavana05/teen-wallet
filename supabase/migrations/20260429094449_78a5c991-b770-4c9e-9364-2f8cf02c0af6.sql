-- Device tokens table
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'android',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON public.device_tokens(user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own device_tokens select" ON public.device_tokens
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own device_tokens insert" ON public.device_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own device_tokens update" ON public.device_tokens
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own device_tokens delete" ON public.device_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Enable pg_net for outbound HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Settings for the webhook URL + shared secret (set via ALTER DATABASE-style GUC at runtime)
-- We read them from current_setting with missing_ok = true and fall back to defaults.

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
  _url := current_setting('app.push_webhook_url', true);
  _secret := current_setting('app.push_webhook_secret', true);

  IF _url IS NULL OR _url = '' THEN
    _url := 'https://teen-wallet.lovable.app/api/public/push-fanout';
  END IF;

  -- Fire-and-forget HTTP POST. Body contains notification id; webhook will look it up + send.
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
  -- Never block the insert if the push fails
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_push_trigger ON public.notifications;
CREATE TRIGGER notifications_push_trigger
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.notify_push_on_insert();

-- Touch trigger for updated_at-style maintenance on device_tokens (optional; updates last_seen_at)
CREATE OR REPLACE FUNCTION public.device_tokens_touch_seen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.last_seen_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_tokens_touch ON public.device_tokens;
CREATE TRIGGER device_tokens_touch
BEFORE UPDATE ON public.device_tokens
FOR EACH ROW EXECUTE FUNCTION public.device_tokens_touch_seen();