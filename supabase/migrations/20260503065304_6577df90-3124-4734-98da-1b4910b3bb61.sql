
-- Create enum for family link stage
CREATE TYPE public.family_link_stage AS ENUM ('none', 'waiting', 'accepted');

-- Add column to profiles
ALTER TABLE public.profiles
  ADD COLUMN family_link_status public.family_link_stage NOT NULL DEFAULT 'none';

-- Auto-set to 'accepted' when a family_link is created for a teen
CREATE OR REPLACE FUNCTION public.auto_update_teen_link_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles
    SET family_link_status = 'accepted'
    WHERE id = NEW.teen_user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_family_link_accepted
  AFTER INSERT ON public.family_links
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_update_teen_link_status();
