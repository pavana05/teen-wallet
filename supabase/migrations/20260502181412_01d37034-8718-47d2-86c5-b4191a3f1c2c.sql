-- Family invite codes for parent-child linking
CREATE TABLE public.family_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  creator_user_id uuid NOT NULL,
  creator_role text NOT NULL CHECK (creator_role IN ('teen', 'parent')),
  target_role text NOT NULL CHECK (target_role IN ('teen', 'parent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  accepted_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

ALTER TABLE public.family_invite_codes ENABLE ROW LEVEL SECURITY;

-- Creator can see their own codes
CREATE POLICY "own invite codes select" ON public.family_invite_codes
  FOR SELECT USING (auth.uid() = creator_user_id);

-- Authenticated users can look up pending codes by value (for accepting)
CREATE POLICY "lookup pending codes" ON public.family_invite_codes
  FOR SELECT TO authenticated
  USING (status = 'pending' AND expires_at > now());

-- Creator can insert their own codes
CREATE POLICY "own invite codes insert" ON public.family_invite_codes
  FOR INSERT WITH CHECK (auth.uid() = creator_user_id);

-- Family links (active parent-child relationships)
CREATE TABLE public.family_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL,
  teen_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  linked_via text NOT NULL DEFAULT 'invite_code' CHECK (linked_via IN ('invite_code', 'qr')),
  invite_code_id uuid REFERENCES public.family_invite_codes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, teen_user_id)
);

ALTER TABLE public.family_links ENABLE ROW LEVEL SECURITY;

-- Parents see links where they are the parent
CREATE POLICY "parent sees own links" ON public.family_links
  FOR SELECT USING (auth.uid() = parent_user_id);

-- Teens see links where they are the teen
CREATE POLICY "teen sees own links" ON public.family_links
  FOR SELECT USING (auth.uid() = teen_user_id);

-- Generate a unique family invite code
CREATE OR REPLACE FUNCTION public.generate_family_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _target text;
  _code text;
  _alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _i int;
  _len int := length(_alphabet);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT account_type INTO _role FROM public.profiles WHERE id = _uid;
  IF _role IS NULL THEN
    RAISE EXCEPTION 'Account type not set';
  END IF;

  _target := CASE WHEN _role = 'parent' THEN 'teen' ELSE 'parent' END;

  -- Cancel any existing pending codes from this user
  UPDATE public.family_invite_codes
    SET status = 'cancelled'
    WHERE creator_user_id = _uid AND status = 'pending';

  -- Generate unique 8-char code
  LOOP
    _code := '';
    FOR _i IN 1..8 LOOP
      _code := _code || substr(_alphabet, 1 + floor(random() * _len)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.family_invite_codes WHERE code = _code);
  END LOOP;

  INSERT INTO public.family_invite_codes (code, creator_user_id, creator_role, target_role)
  VALUES (_code, _uid, _role, _target);

  RETURN _code;
END;
$$;

-- Accept a family invite code
CREATE OR REPLACE FUNCTION public.accept_family_invite(_code text)
RETURNS TABLE(ok boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _my_role text;
  _invite record;
  _parent_id uuid;
  _teen_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN QUERY SELECT false, 'Not authenticated'::text; RETURN;
  END IF;

  SELECT account_type INTO _my_role FROM public.profiles WHERE id = _uid;
  IF _my_role IS NULL THEN
    RETURN QUERY SELECT false, 'Please select your account type first'::text; RETURN;
  END IF;

  SELECT * INTO _invite FROM public.family_invite_codes
    WHERE family_invite_codes.code = upper(trim(_code))
      AND status = 'pending'
      AND expires_at > now();

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Invalid or expired invite code'::text; RETURN;
  END IF;

  IF _invite.creator_user_id = _uid THEN
    RETURN QUERY SELECT false, 'You cannot accept your own invite code'::text; RETURN;
  END IF;

  IF _invite.target_role <> _my_role THEN
    RETURN QUERY SELECT false, ('This code is for a ' || _invite.target_role || ' account')::text; RETURN;
  END IF;

  -- Determine parent and teen
  IF _my_role = 'teen' THEN
    _parent_id := _invite.creator_user_id;
    _teen_id := _uid;
  ELSE
    _parent_id := _uid;
    _teen_id := _invite.creator_user_id;
  END IF;

  -- Check if already linked
  IF EXISTS (SELECT 1 FROM public.family_links WHERE parent_user_id = _parent_id AND teen_user_id = _teen_id AND status = 'active') THEN
    RETURN QUERY SELECT false, 'These accounts are already linked'::text; RETURN;
  END IF;

  -- Create the link
  INSERT INTO public.family_links (parent_user_id, teen_user_id, linked_via, invite_code_id)
  VALUES (_parent_id, _teen_id, 'invite_code', _invite.id);

  -- Mark invite as accepted
  UPDATE public.family_invite_codes
    SET status = 'accepted', accepted_by = _uid, accepted_at = now()
    WHERE id = _invite.id;

  -- Notify both parties
  INSERT INTO public.notifications (user_id, type, title, body) VALUES
    (_parent_id, 'family', '👨‍👧 Family link established', 'Your child account has been successfully linked.'),
    (_teen_id, 'family', '🔗 Parent connected', 'Your parent account has been successfully linked.');

  RETURN QUERY SELECT true, 'Family link created successfully'::text;
END;
$$;
