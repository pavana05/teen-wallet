
-- Editable message templates per onboarding stage (admin-managed)
create table if not exists public.kyc_message_templates (
  id uuid primary key default gen_random_uuid(),
  stage text not null unique check (stage in ('STAGE_3','STAGE_4_PENDING','STAGE_4_REJECTED','STAGE_4_OTHER','STAGE_5')),
  title text not null,
  body text not null,
  updated_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kyc_message_templates enable row level security;

-- Only the service role (admin edge function) can touch this table from clients.
create policy "deny client select on kyc_message_templates"
  on public.kyc_message_templates for select to anon, authenticated using (false);
create policy "deny client insert on kyc_message_templates"
  on public.kyc_message_templates for insert to anon, authenticated with check (false);
create policy "deny client update on kyc_message_templates"
  on public.kyc_message_templates for update to anon, authenticated using (false) with check (false);
create policy "deny client delete on kyc_message_templates"
  on public.kyc_message_templates for delete to anon, authenticated using (false);

create trigger trg_kyc_message_templates_updated
  before update on public.kyc_message_templates
  for each row execute function public.touch_updated_at();

-- Seed defaults
insert into public.kyc_message_templates (stage, title, body) values
  ('STAGE_3', 'Phone verified — finish KYC',
   'Hi {name}! 👋 You completed step 1 (phone verified ✅). Just {remaining} quick steps left — finish KYC to unlock Teen Wallet. Open the app: https://teen-wallet.lovable.app'),
  ('STAGE_4_PENDING', 'KYC under review',
   'Hi {name}! 🚀 Your KYC is under review. We''ll notify you the moment it''s approved. Keep an eye on the app! 🔔'),
  ('STAGE_4_REJECTED', 'KYC needs a quick re-submit',
   'Hi {name}! ❗ Your KYC needs a quick re-submit. It takes under 60s — open the app, retake your selfie + Aadhaar, and you''re in! 📸'),
  ('STAGE_4_OTHER', 'Almost there',
   'Hi {name}! ⚡ You started KYC but didn''t finish. Just one quick step to unlock the wallet → https://teen-wallet.lovable.app'),
  ('STAGE_5', 'Last step — grant permissions',
   'Hi {name}! 🏁 Final step! Grant the app permissions and you''re ready to scan, pay, and earn rewards.')
on conflict (stage) do nothing;

-- Audit + cooldown log of reminders sent to users
create table if not exists public.kyc_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel text not null check (channel in ('whatsapp','sms','zavu','copy')),
  stage text,
  sent_by_admin_id uuid,
  sent_by_email text,
  status text not null default 'sent' check (status in ('sent','failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_kyc_reminder_log_user_recent
  on public.kyc_reminder_log (user_id, created_at desc);

alter table public.kyc_reminder_log enable row level security;

create policy "deny client select on kyc_reminder_log"
  on public.kyc_reminder_log for select to anon, authenticated using (false);
create policy "deny client insert on kyc_reminder_log"
  on public.kyc_reminder_log for insert to anon, authenticated with check (false);
create policy "deny client update on kyc_reminder_log"
  on public.kyc_reminder_log for update to anon, authenticated using (false) with check (false);
create policy "deny client delete on kyc_reminder_log"
  on public.kyc_reminder_log for delete to anon, authenticated using (false);
