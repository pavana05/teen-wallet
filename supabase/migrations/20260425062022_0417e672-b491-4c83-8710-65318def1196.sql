-- Enums
create type public.kyc_status as enum ('not_started','pending','approved','rejected');
create type public.onboarding_stage as enum ('STAGE_0','STAGE_1','STAGE_2','STAGE_3','STAGE_4','STAGE_5');
create type public.txn_status as enum ('success','pending','failed');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  full_name text,
  dob date,
  gender text,
  aadhaar_last4 text,
  kyc_status public.kyc_status not null default 'not_started',
  onboarding_stage public.onboarding_stage not null default 'STAGE_0',
  balance numeric(12,2) not null default 2450.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, phone) values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Transactions
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null,
  merchant_name text not null,
  upi_id text not null,
  note text,
  status public.txn_status not null default 'success',
  fraud_flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;
create policy "own txn select" on public.transactions for select using (auth.uid() = user_id);
create policy "own txn insert" on public.transactions for insert with check (auth.uid() = user_id);

-- Fraud logs
create table public.fraud_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_triggered text not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  resolution text,
  created_at timestamptz not null default now()
);
alter table public.fraud_logs enable row level security;
create policy "own fraud select" on public.fraud_logs for select using (auth.uid() = user_id);
create policy "own fraud insert" on public.fraud_logs for insert with check (auth.uid() = user_id);

-- Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "own notif select" on public.notifications for select using (auth.uid() = user_id);
create policy "own notif insert" on public.notifications for insert with check (auth.uid() = user_id);
create policy "own notif update" on public.notifications for update using (auth.uid() = user_id);
create policy "own notif delete" on public.notifications for delete using (auth.uid() = user_id);

-- Parental links
create table public.parental_links (
  id uuid primary key default gen_random_uuid(),
  teen_user_id uuid not null references auth.users(id) on delete cascade,
  parent_phone text not null,
  parent_verified boolean not null default false,
  spend_limit_daily numeric(12,2),
  spend_limit_weekly numeric(12,2),
  spend_limit_monthly numeric(12,2),
  created_at timestamptz not null default now()
);
alter table public.parental_links enable row level security;
create policy "own parental select" on public.parental_links for select using (auth.uid() = teen_user_id);
create policy "own parental insert" on public.parental_links for insert with check (auth.uid() = teen_user_id);
create policy "own parental update" on public.parental_links for update using (auth.uid() = teen_user_id);
create policy "own parental delete" on public.parental_links for delete using (auth.uid() = teen_user_id);