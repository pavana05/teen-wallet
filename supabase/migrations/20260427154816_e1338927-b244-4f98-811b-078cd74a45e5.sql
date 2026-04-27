-- 1) Add explicit deny-write policies to user_security (defense in depth).
--    Service role bypasses RLS, so the edge function still works.
CREATE POLICY "deny client insert on user_security"
  ON public.user_security FOR INSERT TO authenticated, anon
  WITH CHECK (false);
CREATE POLICY "deny client update on user_security"
  ON public.user_security FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);
CREATE POLICY "deny client delete on user_security"
  ON public.user_security FOR DELETE TO authenticated, anon
  USING (false);

-- 2) Resolve "RLS Enabled No Policy" findings on admin/server-only tables by
--    adding explicit deny-all policies. Service role still bypasses RLS,
--    so admin edge functions continue to work.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_audit_log','admin_notifications','admin_sessions','admin_users','issue_report_notes']
  LOOP
    EXECUTE format('CREATE POLICY "deny client select on %1$s" ON public.%1$s FOR SELECT TO authenticated, anon USING (false);', t);
    EXECUTE format('CREATE POLICY "deny client insert on %1$s" ON public.%1$s FOR INSERT TO authenticated, anon WITH CHECK (false);', t);
    EXECUTE format('CREATE POLICY "deny client update on %1$s" ON public.%1$s FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);', t);
    EXECUTE format('CREATE POLICY "deny client delete on %1$s" ON public.%1$s FOR DELETE TO authenticated, anon USING (false);', t);
  END LOOP;
END $$;

-- 3) Add WebAuthn challenge tracking + transports for proper signature verification.
ALTER TABLE public.user_security
  ADD COLUMN IF NOT EXISTS webauthn_challenge text,
  ADD COLUMN IF NOT EXISTS webauthn_challenge_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS webauthn_challenge_purpose text,
  ADD COLUMN IF NOT EXISTS biometric_transports text[],
  ADD COLUMN IF NOT EXISTS biometric_aaguid text;