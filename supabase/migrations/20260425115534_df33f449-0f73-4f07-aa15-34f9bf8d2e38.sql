CREATE TABLE public.issue_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL,
  category TEXT NOT NULL DEFAULT 'general',
  message TEXT NOT NULL,
  route TEXT NULL,
  user_agent TEXT NULL,
  app_version TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

-- Allow anyone (auth or anon) to file a report. user_id, when present, must match the caller.
CREATE POLICY "anyone can submit issue reports"
ON public.issue_reports
FOR INSERT
TO public
WITH CHECK (user_id IS NULL OR auth.uid() = user_id);

-- Users can view only their own reports.
CREATE POLICY "users view own reports"
ON public.issue_reports
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_issue_reports_user_id ON public.issue_reports(user_id);
CREATE INDEX idx_issue_reports_created_at ON public.issue_reports(created_at DESC);