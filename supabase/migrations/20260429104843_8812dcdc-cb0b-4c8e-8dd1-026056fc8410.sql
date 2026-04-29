-- Tighten notifications RLS: ensure user_id is required and recreate policies
-- so users can only read/modify their own notification rows. Also restrict
-- inserts so that, when a transaction_id is attached for deep-link routing,
-- it must reference a transaction owned by the same user.

ALTER TABLE public.notifications
  ALTER COLUMN user_id SET NOT NULL;

-- Drop and recreate policies with explicit, narrow scopes.
DROP POLICY IF EXISTS "own notif select" ON public.notifications;
DROP POLICY IF EXISTS "own notif insert" ON public.notifications;
DROP POLICY IF EXISTS "own notif update" ON public.notifications;
DROP POLICY IF EXISTS "own notif delete" ON public.notifications;

-- Read: only your own notifications. transaction_id is exposed only on
-- rows you already own, so deep-link resolution stays user-scoped.
CREATE POLICY "notifications select own"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert: must be your row, and any attached transaction_id must point to
-- a transaction you own (defense-in-depth so a tampered client cannot
-- attach someone else's transaction id to their own notification).
CREATE POLICY "notifications insert own"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      transaction_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.id = transaction_id AND t.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "notifications update own"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications delete own"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);