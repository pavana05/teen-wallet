CREATE INDEX IF NOT EXISTS idx_transactions_user_created_at
ON public.transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON public.notifications (user_id, read)
WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_profiles_kyc_followups
ON public.profiles (onboarding_stage, kyc_status, created_at DESC)
WHERE phone IS NOT NULL AND phone <> '';

CREATE INDEX IF NOT EXISTS idx_kyc_reminder_log_sent_recent
ON public.kyc_reminder_log (user_id, created_at DESC)
WHERE status = 'sent';