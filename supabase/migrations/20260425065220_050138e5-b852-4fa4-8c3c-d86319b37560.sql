alter publication supabase_realtime add table public.kyc_submissions;
alter table public.kyc_submissions replica identity full;