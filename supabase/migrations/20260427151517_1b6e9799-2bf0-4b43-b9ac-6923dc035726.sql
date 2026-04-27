-- App-images: an admin-managed library of named image slots
-- (e.g. home.scan_hero, home.scan_hero_diwali) that the app reads at
-- runtime so admins can swap visuals without a redeploy.

CREATE TABLE IF NOT EXISTS public.app_images (
  key                TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  description        TEXT,
  url                TEXT,
  storage_path       TEXT,
  alt                TEXT NOT NULL DEFAULT '',
  width              INTEGER,
  height             INTEGER,
  bytes              INTEGER,
  content_type       TEXT,
  updated_by_email   TEXT,
  created_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_images ENABLE ROW LEVEL SECURITY;

-- Anyone (incl. unauthenticated app visitors) can READ image metadata.
-- Writes are performed only by the admin edge function via service role,
-- so we deliberately do NOT add insert/update/delete policies here.
DROP POLICY IF EXISTS "anyone can read app_images" ON public.app_images;
CREATE POLICY "anyone can read app_images" ON public.app_images
  FOR SELECT TO public USING (true);

-- touch updated_at automatically
DROP TRIGGER IF EXISTS app_images_touch_updated_at ON public.app_images;
CREATE TRIGGER app_images_touch_updated_at
  BEFORE UPDATE ON public.app_images
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime so the app can refresh instantly when an admin uploads.
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_images;

-- Public storage bucket so the uploaded files can be served by their URL
-- with no signed-URL ceremony. The bucket must be public for direct <img> use.
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-images', 'app-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public READ on objects in this bucket. Writes/updates/deletes go through
-- the admin edge function with the service role, so no user-facing write
-- policies are needed.
DROP POLICY IF EXISTS "public read app-images" ON storage.objects;
CREATE POLICY "public read app-images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'app-images');

-- Seed the slots the app currently uses. Admin can later add more rows
-- via the dashboard (function action: app_images_upsert).
INSERT INTO public.app_images (key, label, description, alt) VALUES
  ('home.scan_hero',         'Home — Scan hero (default)', 'Big banner above the home screen tiles. Shown all year except during Diwali.', 'Tap to scan and pay'),
  ('home.scan_hero_diwali',  'Home — Scan hero (Diwali)',  'Festive variant of the scan banner shown automatically during the Diwali window (Oct 25 → Nov 15).', 'Tap to scan and pay — Diwali edition')
ON CONFLICT (key) DO NOTHING;
