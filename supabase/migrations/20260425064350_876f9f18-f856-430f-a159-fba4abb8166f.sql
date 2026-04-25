CREATE TABLE IF NOT EXISTS public.kyc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.kyc_status NOT NULL DEFAULT 'pending',
  provider text NOT NULL DEFAULT 'digio',
  provider_ref text,
  selfie_size_bytes integer,
  selfie_width integer,
  selfie_height integer,
  match_score numeric,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user ON public.kyc_submissions(user_id, created_at DESC);

ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own KYC submissions"
  ON public.kyc_submissions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
