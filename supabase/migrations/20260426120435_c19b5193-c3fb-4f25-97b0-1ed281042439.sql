-- 1) Extra columns on issue_reports
ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS screenshot_path text,
  ADD COLUMN IF NOT EXISTS camera_photo_path text,
  ADD COLUMN IF NOT EXISTS console_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stack_trace text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by_email text;

-- 2) Internal admin notes table
CREATE TABLE IF NOT EXISTS public.issue_report_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.issue_reports(id) ON DELETE CASCADE,
  admin_email text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issue_report_notes_report_id
  ON public.issue_report_notes(report_id, created_at DESC);

ALTER TABLE public.issue_report_notes ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (admin edge function) can read/write.

-- 3) Storage bucket for screenshots / camera photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-attachments', 'issue-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users: upload + read their own folder (auth.uid()/...)
DROP POLICY IF EXISTS "issue-attachments user insert" ON storage.objects;
CREATE POLICY "issue-attachments user insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'issue-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "issue-attachments user read" ON storage.objects;
CREATE POLICY "issue-attachments user read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'issue-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Anonymous reporters: allow upload under 'anon/' prefix only
DROP POLICY IF EXISTS "issue-attachments anon insert" ON storage.objects;
CREATE POLICY "issue-attachments anon insert"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (
  bucket_id = 'issue-attachments'
  AND (storage.foldername(name))[1] = 'anon'
);

-- Helpful index for admin filters
CREATE INDEX IF NOT EXISTS idx_issue_reports_status_created
  ON public.issue_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_issue_reports_category
  ON public.issue_reports(category);