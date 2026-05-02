
CREATE TABLE public.curations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  image_url text,
  image_key text,
  detail_title text,
  detail_body text,
  detail_cta_label text,
  detail_cta_url text,
  accent_color text DEFAULT '#d4c5a0',
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.curations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read curations" ON public.curations
  FOR SELECT TO anon, authenticated USING (active = true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.curations;

CREATE TRIGGER curations_touch_updated_at
  BEFORE UPDATE ON public.curations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
