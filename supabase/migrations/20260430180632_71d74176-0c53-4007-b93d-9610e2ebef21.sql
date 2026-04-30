-- 1. Profiles: Google identity columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_email text,
  ADD COLUMN IF NOT EXISTS google_sub text,
  ADD COLUMN IF NOT EXISTS google_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_link_required boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_google_sub_uniq
  ON public.profiles(google_sub) WHERE google_sub IS NOT NULL;

-- Grandfather: all existing users keep google_link_required = false (default).
-- New signups will have it set to true by the application code after profile creation.

-- 2. Trusted devices
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fingerprint_hash text NOT NULL,
  label text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint_hash)
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON public.trusted_devices(user_id);

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own trusted_devices select" ON public.trusted_devices
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own trusted_devices insert" ON public.trusted_devices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own trusted_devices update" ON public.trusted_devices
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own trusted_devices delete" ON public.trusted_devices
  FOR DELETE USING (auth.uid() = user_id);

-- 3. Phone -> Google index (no direct client access)
CREATE TABLE IF NOT EXISTS public.account_phone_index (
  phone text PRIMARY KEY,
  user_id uuid NOT NULL,
  google_sub text,
  google_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_phone_index ENABLE ROW LEVEL SECURITY;
-- Deny all direct client access (only SECURITY DEFINER functions may touch it).
CREATE POLICY "deny client select on account_phone_index" ON public.account_phone_index
  FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny client insert on account_phone_index" ON public.account_phone_index
  FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "deny client update on account_phone_index" ON public.account_phone_index
  FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on account_phone_index" ON public.account_phone_index
  FOR DELETE TO anon, authenticated USING (false);

-- Backfill the index from existing profiles (phone-only, no Google yet).
INSERT INTO public.account_phone_index (phone, user_id, google_sub, google_email)
SELECT p.phone, p.id, p.google_sub, p.google_email
FROM public.profiles p
WHERE p.phone IS NOT NULL
ON CONFLICT (phone) DO NOTHING;

-- 4. Mask helper for email hints
CREATE OR REPLACE FUNCTION public.mask_email(_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _email IS NULL OR _email = '' THEN NULL
    WHEN position('@' in _email) < 2 THEN _email
    ELSE
      substr(split_part(_email,'@',1), 1, 1)
        || repeat('•', greatest(length(split_part(_email,'@',1)) - 2, 1))
        || substr(split_part(_email,'@',1), length(split_part(_email,'@',1)), 1)
        || '@' || split_part(_email,'@',2)
  END
$$;

-- 5. Public RPC: get_login_requirements (callable by anon)
CREATE OR REPLACE FUNCTION public.get_login_requirements(_phone text)
RETURNS TABLE(requires_google boolean, google_email_hint text, account_exists boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row record;
  _norm text;
BEGIN
  _norm := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF length(_norm) = 10 THEN
    _norm := '+91' || _norm;
  ELSIF left(_norm, 2) = '91' AND length(_norm) = 12 THEN
    _norm := '+' || _norm;
  END IF;

  SELECT api.user_id, api.google_sub, api.google_email, p.google_link_required
    INTO _row
  FROM public.account_phone_index api
  JOIN public.profiles p ON p.id = api.user_id
  WHERE api.phone = _norm;

  IF NOT FOUND THEN
    -- Unknown phone — treat as new signup, no Google required to send OTP.
    RETURN QUERY SELECT false, NULL::text, false;
    RETURN;
  END IF;

  -- Known account: require Google only if the account has Google linked
  -- AND the policy says it must be re-checked.
  IF _row.google_sub IS NOT NULL AND _row.google_link_required THEN
    RETURN QUERY SELECT true, public.mask_email(_row.google_email), true;
  ELSE
    RETURN QUERY SELECT false, NULL::text, true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_login_requirements(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_login_requirements(text) TO anon, authenticated;

-- 6. is_trusted_device (authed)
CREATE OR REPLACE FUNCTION public.is_trusted_device(_fingerprint_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trusted_devices
    WHERE user_id = auth.uid() AND fingerprint_hash = _fingerprint_hash
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_trusted_device(text) TO authenticated;

-- 7. register_trusted_device (authed)
CREATE OR REPLACE FUNCTION public.register_trusted_device(_fingerprint_hash text, _label text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _fingerprint_hash IS NULL OR length(_fingerprint_hash) < 8 THEN
    RAISE EXCEPTION 'Invalid fingerprint';
  END IF;
  INSERT INTO public.trusted_devices (user_id, fingerprint_hash, label)
  VALUES (auth.uid(), _fingerprint_hash, _label)
  ON CONFLICT (user_id, fingerprint_hash)
    DO UPDATE SET last_seen_at = now(), label = COALESCE(EXCLUDED.label, public.trusted_devices.label);
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_trusted_device(text, text) TO authenticated;

-- 8. link_google_to_phone (authed)
CREATE OR REPLACE FUNCTION public.link_google_to_phone(_google_sub text, _google_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
  _existing_owner uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _google_sub IS NULL OR length(_google_sub) < 4 THEN
    RAISE EXCEPTION 'Invalid Google identity';
  END IF;

  -- Reject if this Google account is already linked to a different user.
  SELECT id INTO _existing_owner FROM public.profiles
    WHERE google_sub = _google_sub AND id <> _uid LIMIT 1;
  IF _existing_owner IS NOT NULL THEN
    RAISE EXCEPTION 'This Google account is already linked to another wallet'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.profiles
    SET google_sub = _google_sub,
        google_email = lower(_google_email),
        google_linked_at = now(),
        google_link_required = true
    WHERE id = _uid
    RETURNING phone INTO _phone;

  IF _phone IS NOT NULL THEN
    INSERT INTO public.account_phone_index (phone, user_id, google_sub, google_email, updated_at)
      VALUES (_phone, _uid, _google_sub, lower(_google_email), now())
    ON CONFLICT (phone) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          google_sub = EXCLUDED.google_sub,
          google_email = EXCLUDED.google_email,
          updated_at = now();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_google_to_phone(text, text) TO authenticated;

-- 9. verify_google_for_phone (authed): caller must be signed in (via temp google session OR pending phone session)
CREATE OR REPLACE FUNCTION public.verify_google_for_phone(_phone text, _google_sub text)
RETURNS TABLE(ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _norm text;
  _stored text;
BEGIN
  _norm := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF length(_norm) = 10 THEN _norm := '+91' || _norm;
  ELSIF left(_norm, 2) = '91' AND length(_norm) = 12 THEN _norm := '+' || _norm;
  END IF;

  SELECT google_sub INTO _stored FROM public.account_phone_index WHERE phone = _norm;
  IF _stored IS NULL THEN
    RETURN QUERY SELECT true, 'no_link_required'::text; RETURN;
  END IF;
  IF _stored = _google_sub THEN
    RETURN QUERY SELECT true, 'match'::text; RETURN;
  END IF;
  RETURN QUERY SELECT false, 'mismatch'::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_google_for_phone(text, text) TO anon, authenticated;

-- 10. Keep account_phone_index in sync when profile.phone changes
CREATE OR REPLACE FUNCTION public.profiles_sync_phone_index()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    INSERT INTO public.account_phone_index (phone, user_id, google_sub, google_email, updated_at)
      VALUES (NEW.phone, NEW.id, NEW.google_sub, NEW.google_email, now())
    ON CONFLICT (phone) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          google_sub = EXCLUDED.google_sub,
          google_email = EXCLUDED.google_email,
          updated_at = now();
  END IF;
  -- If the phone changed, remove the old row.
  IF TG_OP = 'UPDATE' AND OLD.phone IS NOT NULL AND OLD.phone IS DISTINCT FROM NEW.phone THEN
    DELETE FROM public.account_phone_index WHERE phone = OLD.phone AND user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_phone_index_trg ON public.profiles;
CREATE TRIGGER profiles_sync_phone_index_trg
  AFTER INSERT OR UPDATE OF phone, google_sub, google_email ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_sync_phone_index();