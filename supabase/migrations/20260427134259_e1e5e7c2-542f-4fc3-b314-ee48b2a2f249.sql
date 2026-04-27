-- Payment attempts: persistent state for in-progress and completed payments
CREATE TYPE public.payment_stage AS ENUM ('confirm', 'processing', 'success', 'failed', 'cancelled');
CREATE TYPE public.payment_method AS ENUM ('upi', 'wallet', 'card');

CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payee_name text NOT NULL,
  upi_id text NOT NULL,
  note text,
  method public.payment_method NOT NULL DEFAULT 'upi',
  stage public.payment_stage NOT NULL DEFAULT 'confirm',
  transaction_id uuid,
  provider_ref text,
  failure_reason text,
  fraud_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  -- Simulated webhook ETA: when polling should consider it complete
  webhook_due_at timestamptz
);

CREATE INDEX idx_payment_attempts_user_stage ON public.payment_attempts(user_id, stage, created_at DESC);
CREATE INDEX idx_payment_attempts_resume ON public.payment_attempts(user_id, created_at DESC)
  WHERE stage IN ('confirm', 'processing');

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own payment_attempts select"
  ON public.payment_attempts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "own payment_attempts insert"
  ON public.payment_attempts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own payment_attempts update"
  ON public.payment_attempts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_payment_attempts_touch
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Simulated PSP webhook: callable from a server function via RPC.
-- Marks attempts whose webhook_due_at has passed as 'success', creates the
-- transaction row, and debits the wallet — atomically. Caller authorizes
-- via RLS (security invoker), so only the owner can finalize their attempt.
CREATE OR REPLACE FUNCTION public.finalize_due_payment_attempt(_attempt_id uuid)
RETURNS TABLE (
  id uuid,
  stage public.payment_stage,
  transaction_id uuid,
  failure_reason text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _attempt public.payment_attempts;
  _balance numeric;
  _txn_id uuid;
BEGIN
  SELECT * INTO _attempt FROM public.payment_attempts WHERE payment_attempts.id = _attempt_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Already terminal? Just return current state.
  IF _attempt.stage IN ('success', 'failed', 'cancelled') THEN
    RETURN QUERY SELECT _attempt.id, _attempt.stage, _attempt.transaction_id, _attempt.failure_reason, NULL::numeric;
    RETURN;
  END IF;

  -- Not yet "due" by the simulated PSP — keep processing.
  IF _attempt.stage = 'processing' AND (_attempt.webhook_due_at IS NULL OR _attempt.webhook_due_at > now()) THEN
    RETURN QUERY SELECT _attempt.id, _attempt.stage, _attempt.transaction_id, _attempt.failure_reason, NULL::numeric;
    RETURN;
  END IF;

  -- Still in 'confirm' — nothing to finalize.
  IF _attempt.stage = 'confirm' THEN
    RETURN QUERY SELECT _attempt.id, _attempt.stage, _attempt.transaction_id, _attempt.failure_reason, NULL::numeric;
    RETURN;
  END IF;

  -- Time to finalize: re-check balance, debit, insert txn.
  SELECT balance INTO _balance FROM public.profiles WHERE profiles.id = _attempt.user_id FOR UPDATE;

  IF _balance IS NULL OR _balance < _attempt.amount THEN
    UPDATE public.payment_attempts
    SET stage = 'failed',
        failure_reason = 'Insufficient balance at settlement',
        completed_at = now()
    WHERE payment_attempts.id = _attempt.id;

    RETURN QUERY SELECT _attempt.id, 'failed'::public.payment_stage, NULL::uuid,
                        'Insufficient balance at settlement'::text, _balance;
    RETURN;
  END IF;

  INSERT INTO public.transactions (user_id, amount, merchant_name, upi_id, note, status, fraud_flags)
  VALUES (_attempt.user_id, _attempt.amount, _attempt.payee_name, _attempt.upi_id, _attempt.note, 'success', _attempt.fraud_flags)
  RETURNING transactions.id INTO _txn_id;

  UPDATE public.profiles
  SET balance = balance - _attempt.amount
  WHERE profiles.id = _attempt.user_id;

  UPDATE public.payment_attempts
  SET stage = 'success',
      transaction_id = _txn_id,
      provider_ref = COALESCE(_attempt.provider_ref, 'SIM-' || substr(_txn_id::text, 1, 8)),
      completed_at = now()
  WHERE payment_attempts.id = _attempt.id;

  INSERT INTO public.notifications (user_id, type, title, body)
  VALUES (_attempt.user_id, 'transaction',
          '₹' || _attempt.amount::text || ' paid to ' || _attempt.payee_name,
          _attempt.upi_id);

  RETURN QUERY SELECT _attempt.id, 'success'::public.payment_stage, _txn_id, NULL::text,
                      (_balance - _attempt.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_due_payment_attempt(uuid) TO authenticated;