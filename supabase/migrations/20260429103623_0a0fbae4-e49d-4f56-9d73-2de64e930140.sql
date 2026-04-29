-- Add transaction reference for deep-linking
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS transaction_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_transaction_id
  ON public.notifications(transaction_id);

-- Configure push webhook URL + secret used by notify_push_on_insert trigger
INSERT INTO public.app_settings (key, value)
VALUES
  ('push_webhook_url', 'https://project--6a1f940a-fc84-41fb-9c88-54e80717a61e.lovable.app/api/public/push-fanout'),
  ('push_webhook_secret', 'fe4ec29e8dd9d56bfe8a62c5236484fb8ed4e3bbeb0afc22b83cd33bf88daaa0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();