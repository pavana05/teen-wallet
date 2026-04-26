-- contacts: persisted UPI recipients per user
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  upi_id text NOT NULL,
  phone text,
  emoji text,
  verified boolean NOT NULL DEFAULT false,
  last_paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_user_upi_unique UNIQUE (user_id, upi_id),
  CONSTRAINT contacts_upi_format CHECK (upi_id ~* '^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$')
);

CREATE INDEX IF NOT EXISTS contacts_user_recent_idx
  ON public.contacts (user_id, last_paid_at DESC NULLS LAST);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own contacts select"
  ON public.contacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own contacts insert"
  ON public.contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own contacts update"
  ON public.contacts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "own contacts delete"
  ON public.contacts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER contacts_touch_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();