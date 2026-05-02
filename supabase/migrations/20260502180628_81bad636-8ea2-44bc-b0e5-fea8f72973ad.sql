-- Add account_type to profiles
ALTER TABLE public.profiles
ADD COLUMN account_type text DEFAULT NULL;

-- Add check constraint for valid values
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_account_type_check CHECK (account_type IS NULL OR account_type IN ('teen', 'parent'));