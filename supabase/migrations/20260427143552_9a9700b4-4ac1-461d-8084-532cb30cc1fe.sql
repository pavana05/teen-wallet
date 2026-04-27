-- =========================================================
-- Referral program: codes, redemptions, helper functions
-- =========================================================

-- 1. Codes table — one row per user
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own referral_code select"
  ON public.referral_codes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own referral_code insert"
  ON public.referral_codes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 2. Referrals ledger
DO $$ BEGIN
  CREATE TYPE public.referral_status AS ENUM ('pending', 'completed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL,
  referred_user_id uuid NOT NULL UNIQUE,  -- a user can be referred at most once
  code text NOT NULL,
  status public.referral_status NOT NULL DEFAULT 'pending',
  referrer_reward numeric NOT NULL DEFAULT 0,
  referred_reward numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT no_self_referral CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals(code);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referrer sees own referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_user_id);

CREATE POLICY "referred sees own referral"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referred_user_id);
-- No client-side INSERT/UPDATE/DELETE; mutations go through the security-definer
-- functions defined below.

-- 3. Generate / fetch my code
CREATE OR REPLACE FUNCTION public.get_or_create_my_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing text;
  _candidate text;
  _alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no I/O/0/1 to avoid confusion
  _i int;
  _len int := length(_alphabet);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT code INTO _existing FROM public.referral_codes WHERE user_id = _uid;
  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  -- Collision-free 8-char code
  LOOP
    _candidate := '';
    FOR _i IN 1..8 LOOP
      _candidate := _candidate || substr(_alphabet, 1 + floor(random() * _len)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = _candidate);
  END LOOP;

  INSERT INTO public.referral_codes (user_id, code)
  VALUES (_uid, _candidate)
  ON CONFLICT (user_id) DO UPDATE SET code = public.referral_codes.code
  RETURNING code INTO _existing;

  RETURN _existing;
END;
$$;

-- 4. Redeem someone else's code (one-shot, optional during onboarding)
CREATE OR REPLACE FUNCTION public.redeem_referral_code(_code text)
RETURNS TABLE(ok boolean, message text, referred_reward numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _norm text;
  _referrer uuid;
  _referrer_reward numeric := 25.00;
  _referred_reward numeric := 50.00;
BEGIN
  IF _uid IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated', 0::numeric; RETURN;
  END IF;

  _norm := upper(trim(coalesce(_code, '')));
  IF length(_norm) < 4 OR length(_norm) > 16 THEN
    RETURN QUERY SELECT false, 'Enter a valid referral code', 0::numeric; RETURN;
  END IF;

  -- Already redeemed?
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_user_id = _uid) THEN
    RETURN QUERY SELECT false, 'You''ve already used a referral code', 0::numeric; RETURN;
  END IF;

  SELECT user_id INTO _referrer FROM public.referral_codes WHERE code = _norm;
  IF _referrer IS NULL THEN
    RETURN QUERY SELECT false, 'That code doesn''t exist', 0::numeric; RETURN;
  END IF;

  IF _referrer = _uid THEN
    RETURN QUERY SELECT false, 'You can''t use your own code', 0::numeric; RETURN;
  END IF;

  INSERT INTO public.referrals (
    referrer_user_id, referred_user_id, code, status,
    referrer_reward, referred_reward, completed_at
  ) VALUES (
    _referrer, _uid, _norm, 'completed',
    _referrer_reward, _referred_reward, now()
  );

  -- Credit both wallets
  UPDATE public.profiles SET balance = balance + _referred_reward WHERE id = _uid;
  UPDATE public.profiles SET balance = balance + _referrer_reward WHERE id = _referrer;

  -- Notify both sides
  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    _uid, 'offer',
    '🎉 Welcome bonus credited',
    '₹' || _referred_reward::text || ' added to your wallet for using a referral code'
  );

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (
    _referrer, 'offer',
    '🎁 Referral reward earned',
    '₹' || _referrer_reward::text || ' added — a friend just joined using your code'
  );

  RETURN QUERY SELECT true, 'Referral applied', _referred_reward;
END;
$$;