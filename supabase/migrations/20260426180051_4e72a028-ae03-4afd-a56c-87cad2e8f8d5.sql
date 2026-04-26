
-- Gender-targeted offers shown on the user's home screen
CREATE TABLE public.gender_offers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gender_target TEXT NOT NULL CHECK (gender_target IN ('boy','girl','all')),
  eyebrow TEXT NOT NULL,
  headline TEXT NOT NULL,
  emphasis TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  cta_label TEXT NOT NULL DEFAULT 'Apply offer',
  accent TEXT NOT NULL DEFAULT 'neutral' CHECK (accent IN ('boy','girl','neutral')),
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gender_offers_target_active ON public.gender_offers(gender_target, active, sort_order);
ALTER TABLE public.gender_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active offers"
  ON public.gender_offers FOR SELECT
  USING (active = true);

-- Gender-specific rewards rules (cashback tiers per category)
CREATE TABLE public.gender_rewards_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gender_target TEXT NOT NULL CHECK (gender_target IN ('boy','girl','all')),
  category TEXT NOT NULL,
  cashback_pct NUMERIC(5,2) NOT NULL CHECK (cashback_pct >= 0 AND cashback_pct <= 100),
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gender_rewards_target_active ON public.gender_rewards_rules(gender_target, active, sort_order);
ALTER TABLE public.gender_rewards_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active rewards rules"
  ON public.gender_rewards_rules FOR SELECT
  USING (active = true);

-- Touch updated_at triggers
CREATE TRIGGER trg_gender_offers_touch
  BEFORE UPDATE ON public.gender_offers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_gender_rewards_touch
  BEFORE UPDATE ON public.gender_rewards_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed boy-targeted offers
INSERT INTO public.gender_offers (gender_target, eyebrow, headline, emphasis, subtitle, cta_label, accent, sort_order) VALUES
  ('boy', 'Gaming · Limited', '25%', 'cashback', 'On every in-game top-up this month', 'Claim now', 'boy', 10),
  ('boy', 'Sports gear', '15%', 'flat off', 'Cricket, football, fitness — instant credit', 'Apply offer', 'boy', 20),
  ('girl', 'Fashion · Limited', '25%', 'cashback', 'On Myntra, Nykaa & H&M this month', 'Claim now', 'girl', 10),
  ('girl', 'Beauty & wellness', '15%', 'flat off', 'Salon, skincare & spa bookings', 'Apply offer', 'girl', 20),
  ('all', 'P2P UPI · Limited', '20%', 'flat off', 'On every peer transfer this month', 'Apply offer', 'neutral', 50),
  ('all', 'First recharge', '40%', 'cashback', 'Credited instantly to your wallet', 'Claim now', 'neutral', 60);

-- Seed rewards rules
INSERT INTO public.gender_rewards_rules (gender_target, category, cashback_pct, description, sort_order) VALUES
  ('boy', 'Gaming', 5.00, '5% back on gaming top-ups', 10),
  ('boy', 'Sports', 3.00, '3% back on sports & fitness', 20),
  ('boy', 'Tech', 2.00, '2% back on gadgets & accessories', 30),
  ('girl', 'Fashion', 5.00, '5% back on fashion & apparel', 10),
  ('girl', 'Beauty', 3.00, '3% back on beauty & wellness', 20),
  ('girl', 'Lifestyle', 2.00, '2% back on lifestyle & decor', 30),
  ('all', 'UPI Transfer', 1.00, '1% back on every UPI payment', 100);
