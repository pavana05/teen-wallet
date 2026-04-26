ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS notif_prefs jsonb NOT NULL DEFAULT
    '{"sms_payments":true,"email_payments":true,"sms_otp":true,"email_otp":false,"sms_kyc":true,"email_kyc":true,"push_marketing":false}'::jsonb;

-- Soft format check via trigger (CHECK constraints with regex are fine, but trigger keeps it skippable for null).
CREATE OR REPLACE FUNCTION public.profiles_validate_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    IF NEW.email !~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'Invalid email format: %', NEW.email USING ERRCODE = '22023';
    END IF;
    NEW.email := lower(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_email_trg ON public.profiles;
CREATE TRIGGER profiles_validate_email_trg
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_validate_email();

CREATE INDEX IF NOT EXISTS profiles_email_idx ON public.profiles (email) WHERE email IS NOT NULL;