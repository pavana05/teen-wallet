create or replace function public.admin_email_allowed(_email text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(_email) like '%@teenwallet.in'
      or lower(_email) = 'pavana25t@gmail.com';
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'admin_audit_log is immutable';
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;