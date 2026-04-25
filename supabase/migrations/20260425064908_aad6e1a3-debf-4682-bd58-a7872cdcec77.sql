-- Private bucket for KYC documents (Aadhaar front/back). User-scoped via folder = auth.uid().
insert into storage.buckets (id, name, public)
values ('kyc-docs', 'kyc-docs', false)
on conflict (id) do nothing;

create policy "Users can view own kyc docs"
on storage.objects for select to authenticated
using (bucket_id = 'kyc-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload own kyc docs"
on storage.objects for insert to authenticated
with check (bucket_id = 'kyc-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own kyc docs"
on storage.objects for update to authenticated
using (bucket_id = 'kyc-docs' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own kyc docs"
on storage.objects for delete to authenticated
using (bucket_id = 'kyc-docs' and auth.uid()::text = (storage.foldername(name))[1]);