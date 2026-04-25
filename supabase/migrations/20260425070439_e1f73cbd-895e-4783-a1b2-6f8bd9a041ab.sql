-- ============================================================
-- ADMIN DASHBOARD: Schema, RLS, seed
-- ============================================================

-- Enums
do $$ begin
  create type public.app_admin_role as enum (
    'super_admin',
    'operations_manager',
    'compliance_officer',
    'customer_support',
    'fraud_analyst',
    'finance_manager'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.admin_status as enum ('active', 'locked', 'disabled', 'pending');
exception when duplicate_object then null; end $$;

-- ============================================================
-- admin_users
-- ============================================================
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  role public.app_admin_role not null,
  status public.admin_status not null default 'pending',
  password_hash text,                        -- bcrypt-style hash set on first login / seed
  totp_secret text,                          -- base32 secret
  totp_enrolled boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  last_login_ip text,
  ip_allowlist text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Domain restriction: @teenwallet.in OR explicit allowlist (the seeded super admin)
create or replace function public.admin_email_allowed(_email text)
returns boolean
language sql
immutable
as $$
  select lower(_email) like '%@teenwallet.in'
      or lower(_email) = 'pavana25t@gmail.com';
$$;

alter table public.admin_users drop constraint if exists admin_users_email_domain_chk;
alter table public.admin_users
  add constraint admin_users_email_domain_chk
  check (public.admin_email_allowed(email));

create index if not exists idx_admin_users_email on public.admin_users(lower(email));
create index if not exists idx_admin_users_role on public.admin_users(role);

-- ============================================================
-- admin_sessions
-- ============================================================
create table if not exists public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users(id) on delete cascade,
  session_token_hash text not null,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  invalidated_at timestamptz
);
create index if not exists idx_admin_sessions_admin on public.admin_sessions(admin_id);
create index if not exists idx_admin_sessions_token on public.admin_sessions(session_token_hash);

-- ============================================================
-- admin_audit_log (immutable)
-- ============================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.admin_users(id) on delete set null,
  admin_email text,
  admin_role public.app_admin_role,
  action_type text not null,
  target_entity text,
  target_id text,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  user_agent text,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_admin on public.admin_audit_log(admin_id);
create index if not exists idx_audit_action on public.admin_audit_log(action_type);
create index if not exists idx_audit_created on public.admin_audit_log(created_at desc);

-- Block UPDATE/DELETE on audit log
create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is immutable';
end;
$$;

drop trigger if exists trg_audit_no_update on public.admin_audit_log;
create trigger trg_audit_no_update
before update or delete on public.admin_audit_log
for each row execute function public.prevent_audit_mutation();

-- ============================================================
-- admin_notifications
-- ============================================================
create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users(id) on delete cascade,
  type text not null,
  priority text not null default 'low',     -- low / medium / high / critical
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_notif_admin on public.admin_notifications(admin_id, read, created_at desc);

-- ============================================================
-- RLS
-- ============================================================
alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_notifications enable row level security;

-- All admin tables are accessed exclusively via the service-role edge function.
-- Deny-all default by NOT creating any anon/authenticated policies.
-- (No policies = no access for anon/authenticated; service_role bypasses RLS.)

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_touch on public.admin_users;
create trigger trg_admin_users_touch
before update on public.admin_users
for each row execute function public.touch_updated_at();

-- ============================================================
-- Seed super admin (idempotent)
-- ============================================================
insert into public.admin_users (email, name, role, status)
values ('pavana25t@gmail.com', 'Pavitej', 'super_admin', 'pending')
on conflict (email) do nothing;