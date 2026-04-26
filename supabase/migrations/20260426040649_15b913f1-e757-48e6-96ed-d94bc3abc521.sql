ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school_name text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_pincode text;

-- Light validation: pincode must be 6 digits if provided
CREATE OR REPLACE FUNCTION public.profiles_validate_address()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.address_pincode IS NOT NULL AND NEW.address_pincode <> '' THEN
    IF NEW.address_pincode !~ '^[0-9]{6}$' THEN
      RAISE EXCEPTION 'Invalid pincode (must be 6 digits): %', NEW.address_pincode USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_validate_address_trg ON public.profiles;
CREATE TRIGGER profiles_validate_address_trg
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_validate_address();