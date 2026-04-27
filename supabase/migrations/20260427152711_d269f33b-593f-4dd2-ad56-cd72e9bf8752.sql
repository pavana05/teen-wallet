-- App Lock: per-user security settings (PIN, biometric, auto-lock prefs, attempt tracking)
create table if not exists public.user_security (
  user_id uuid primary key,
  pin_hash text,                          -- PBKDF2-SHA256 hex digest, set server-side only
  pin_salt text,                          -- per-user random salt
  pin_iterations integer not null default 210000,
  pin_length integer,                     -- 4 or 6, for UI
  biometric_credential_id text,           -- WebAuthn credential id (base64url)
  biometric_public_key text,              -- WebAuthn public key (base64url, COSE)
  biometric_sign_count bigint not null default 0,
  app_lock_enabled boolean not null default false,
  auto_lock_seconds integer not null default 30,    -- 0 = immediately, -1 = never (still locks on cold start)
  lock_after_payment boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  setup_prompt_dismissed_at timestamptz,  -- so we only nudge once
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_security enable row level security;

-- Users can read their own security row (UI needs to know enabled / auto_lock_seconds / lock_after_payment).
-- Sensitive fields (pin_hash, pin_salt) are still readable by the user but not useful — verification happens server-side.
create policy "own user_security select"
  on public.user_security for select
  using (auth.uid() = user_id);

-- Inserts / updates from the client are blocked. All mutations go through the app-lock edge function
-- which uses the service role and enforces hashing + rate limiting. We still create a permissive update
-- policy ONLY for the dismiss-prompt flag below via a SECURITY DEFINER function — no direct DML allowed.

-- Helper: dismiss the one-time setup prompt without exposing other columns to client UPDATEs.
create or replace function public.dismiss_app_lock_prompt()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.user_security (user_id, setup_prompt_dismissed_at)
    values (auth.uid(), now())
  on conflict (user_id) do update
    set setup_prompt_dismissed_at = now(),
        updated_at = now();
end;
$$;

grant execute on function public.dismiss_app_lock_prompt() to authenticated;

-- Touch updated_at automatically
create trigger user_security_touch_updated
  before update on public.user_security
  for each row execute function public.touch_updated_at();