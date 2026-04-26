ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_tag text NOT NULL DEFAULT 'standard';

CREATE INDEX IF NOT EXISTS idx_profiles_account_locked ON public.profiles (account_locked) WHERE account_locked = true;
CREATE INDEX IF NOT EXISTS idx_profiles_account_tag ON public.profiles (account_tag);