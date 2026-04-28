-- Priority enum for tickets
DO $$ BEGIN
  CREATE TYPE public.issue_priority AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS priority public.issue_priority NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_to_email text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

-- Backfill last_activity_at to created_at for existing rows
UPDATE public.issue_reports
SET last_activity_at = COALESCE(resolved_at, created_at)
WHERE last_activity_at = created_at AND created_at < now() - interval '1 second';

-- Indexes for queue queries
CREATE INDEX IF NOT EXISTS issue_reports_status_idx ON public.issue_reports(status);
CREATE INDEX IF NOT EXISTS issue_reports_priority_idx ON public.issue_reports(priority);
CREATE INDEX IF NOT EXISTS issue_reports_last_activity_idx ON public.issue_reports(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_assigned_idx ON public.issue_reports(assigned_to_email);

-- Trigger: bump last_activity_at on report row update
CREATE OR REPLACE FUNCTION public.issue_reports_touch_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.last_activity_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_reports_touch_activity_trg ON public.issue_reports;
CREATE TRIGGER issue_reports_touch_activity_trg
BEFORE UPDATE ON public.issue_reports
FOR EACH ROW EXECUTE FUNCTION public.issue_reports_touch_activity();

-- Trigger: when a note (admin reply) is added, bump parent activity
CREATE OR REPLACE FUNCTION public.issue_report_notes_bump_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.issue_reports
    SET last_activity_at = now()
    WHERE id = NEW.report_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_report_notes_bump_parent_trg ON public.issue_report_notes;
CREATE TRIGGER issue_report_notes_bump_parent_trg
AFTER INSERT ON public.issue_report_notes
FOR EACH ROW EXECUTE FUNCTION public.issue_report_notes_bump_parent();