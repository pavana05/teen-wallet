ALTER TABLE public.kyc_submissions
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS doc_front_path text,
  ADD COLUMN IF NOT EXISTS doc_back_path text;